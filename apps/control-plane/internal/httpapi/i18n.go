package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strings"
)

const localeChinese = "zh-CN"

// localizeErrors keeps error codes stable for API clients while translating
// their human-readable companion message at the HTTP boundary. Worker errors
// remain code-first in storage and are localized only when read by a user.
func localizeErrors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// SSE must flush events progressively and cannot be buffered.
		if strings.HasSuffix(r.URL.Path, "/events") {
			next.ServeHTTP(w, r)
			return
		}
		recorder := &localizedResponseWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(recorder, r)
		recorder.flush(requestLocale(r))
	})
}

type localizedResponseWriter struct {
	http.ResponseWriter
	status      int
	wroteHeader bool
	body        bytes.Buffer
}

func (w *localizedResponseWriter) WriteHeader(status int) {
	if w.wroteHeader {
		return
	}
	w.status = status
	w.wroteHeader = true
}

func (w *localizedResponseWriter) Write(value []byte) (int, error) {
	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}
	return w.body.Write(value)
}

func (w *localizedResponseWriter) flush(locale string) {
	body := w.body.Bytes()
	if w.status >= http.StatusBadRequest && strings.Contains(w.Header().Get("Content-Type"), "application/json") {
		var payload map[string]any
		if json.Unmarshal(body, &payload) == nil {
			if code, ok := payload["code"].(string); ok {
				if message, ok := payload["message"].(string); ok {
					payload["message"] = localizedErrorMessage(locale, code, message)
					if encoded, err := json.Marshal(payload); err == nil {
						body = append(encoded, '\n')
					}
				}
			}
		}
	}
	w.Header().Set("Content-Language", locale)
	w.ResponseWriter.WriteHeader(w.status)
	_, _ = w.ResponseWriter.Write(body)
}

func requestLocale(r *http.Request) string {
	requested := strings.ToLower(strings.TrimSpace(r.Header.Get("X-CertFlow-Locale")))
	if requested == "" {
		requested = strings.ToLower(r.Header.Get("Accept-Language"))
	}
	if strings.HasPrefix(requested, "zh") {
		return localeChinese
	}
	return "en"
}

func localizedErrorMessage(locale, code, fallback string) string {
	if locale != localeChinese {
		return fallback
	}
	if message, ok := chineseErrorMessages[code]; ok {
		return message
	}
	switch {
	case strings.HasPrefix(code, "invalid_"):
		return "请求参数无效，请检查后重试"
	case strings.HasSuffix(code, "_not_found"):
		return "未找到请求的资源"
	case strings.HasSuffix(code, "_unavailable"):
		return "相关服务暂时不可用，请稍后重试"
	case strings.HasSuffix(code, "_create_failed"):
		return "创建失败，请稍后重试"
	case strings.HasSuffix(code, "_update_failed"):
		return "更新失败，请稍后重试"
	case strings.HasSuffix(code, "_delete_failed"):
		return "删除失败，请稍后重试"
	case strings.HasSuffix(code, "_verification_failed"):
		return "验证失败，请检查配置和权限"
	case strings.HasSuffix(code, "_queue_failed"):
		return "任务加入队列失败，请稍后重试"
	default:
		return "请求未能完成，请稍后重试"
	}
}

// The explicit entries cover security-sensitive and commonly actionable
// failures. The category fallback above ensures every API error has a usable
// Chinese rendering even when a new backend code is introduced.
var chineseErrorMessages = map[string]string{
	"authentication_required":                   "请先登录后再继续",
	"admin_required":                            "此操作需要管理员权限",
	"account_disabled":                          "该账户已被禁用",
	"account_locked":                            "该账户已被临时锁定，请稍后重试",
	"invalid_credentials":                       "邮箱或密码不正确",
	"invalid_email":                             "请输入有效的邮箱地址",
	"invalid_password":                          "密码不符合要求",
	"invalid_code":                              "验证码无效或已过期",
	"registration_failed":                       "该邮箱已注册",
	"verification_rate_limited":                 "请等待一分钟后再获取验证码",
	"smtp_not_configured":                       "管理员尚未配置邮件服务",
	"email_delivery_failed":                     "无法发送验证邮件",
	"refresh_token_missing":                     "登录状态已过期，请重新登录",
	"refresh_token_invalid":                     "登录状态无效，请重新登录",
	"database_unavailable":                      "数据库暂时不可用，请稍后重试",
	"internal_error":                            "服务器发生意外错误，请稍后重试",
	"invalid_json":                              "请求内容格式不正确",
	"resource_in_use":                           "该资源仍被有效配置引用，无法删除",
	"cloud_credential_immutable":                "AccessKey ID 和 Secret 不可修改，请删除后重新创建凭证",
	"cloud_credential_capability_missing":       "所选云凭证不具备此操作所需权限",
	"certificate_dns_zone_not_allowed":          "一个或多个域名不在 DNS 账户允许管理的 Zone 内",
	"certificate_configuration_unavailable":     "ACME 或 DNS 账户未启用或尚未通过验证",
	"certificate_issuance_in_progress":          "该证书已有签发或续期任务正在执行",
	"automation_run_in_progress":                "该自动化任务已有批次正在排队或执行",
	"automation_name_exists":                    "自动化任务名称已存在，请使用其他名称",
	"manual_challenge_not_found":                "未找到等待确认的手动 DNS 验证",
	"manual_challenge_not_waiting":              "手动 DNS 验证当前不等待确认",
	"webhook_not_configured":                    "请先填写并保存 Webhook 地址，再发送测试",
	"webhook_delivery_failed":                   "Webhook 测试投递失败",
	"notification_read_limit":                   "一次最多可更新 100 条通知",
	"aliyun_unavailable":                        "阿里云 API 暂时不可用，请稍后重试",
	"aliyun_name_duplicate":                     "阿里云证书名称已存在，请重试以生成新的版本名称",
	"dns_provider_unavailable":                  "DNS 服务商操作失败，请稍后重试",
	"streaming_unsupported":                     "当前响应不支持实时事件流",
	"cloud_credential_unavailable":              "云凭证不可用，请先完成验证或启用凭证",
	"cloud_credential_invalid":                  "云凭证验证失败，请检查 AccessKey 和权限",
	"cloud_credential_not_found":                "未找到云凭证",
	"acme_account_not_found":                    "未找到 ACME 账户",
	"dns_account_not_found":                     "未找到 DNS 账户",
	"certificate_not_found":                     "未找到证书",
	"automation_not_found":                      "未找到自动化任务",
	"deployment_target_not_found":               "未找到 ALB 部署目标",
	"deployment_not_ready":                      "部署目标需要已启用，且证书必须已签发",
	"automation_queue_failed":                   "自动化任务加入队列失败，请稍后重试",
	"certificate_issue_queue_failed":            "证书签发任务加入队列失败，请稍后重试",
	"cloud_credential_verification_save_failed": "无法保存云凭证验证结果",
}
