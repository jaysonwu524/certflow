package mailer

import (
	"context"
	"crypto/tls"
	"encoding/base64"
	"errors"
	"fmt"
	"net"
	"net/smtp"
	"strings"
	"time"

	"github.com/regenbio/certflow/apps/control-plane/internal/store"
)

var ErrImplicitTLSRequired = errors.New("SMTP port 465 requires SSL encryption; use SSL with port 465 or STARTTLS with port 587")

func ValidateSettings(settings store.SMTPSettings) error {
	port := settings.EncryptPort
	if port == 0 {
		port = settings.Port
	}
	if port == 465 && strings.EqualFold(settings.EncryptType, "STARTTLS") {
		return ErrImplicitTLSRequired
	}
	return nil
}

func Send(ctx context.Context, settings store.SMTPSettings, to, subject, body string) error {
	port := settings.EncryptPort
	if port == 0 {
		port = settings.Port
	}
	if strings.TrimSpace(settings.Host) == "" || port < 1 || strings.TrimSpace(settings.FromEmail) == "" {
		return fmt.Errorf("smtp is not configured")
	}
	if err := ValidateSettings(settings); err != nil {
		return err
	}
	addr := net.JoinHostPort(settings.Host, fmt.Sprintf("%d", port))
	from := settings.FromEmail
	if settings.FromName != "" {
		from = fmt.Sprintf("%s <%s>", mimeHeader(settings.FromName), settings.FromEmail)
	}
	message := []byte("From: " + from + "\r\nTo: " + to + "\r\nSubject: " + mimeHeader(subject) + "\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n" + body + "\r\n")
	var auth smtp.Auth
	if settings.Auth && settings.Username != "" {
		auth = smtp.PlainAuth("", settings.Username, settings.Password, settings.Host)
	}
	deadline := time.Now().Add(15 * time.Second)
	if requestedDeadline, ok := ctx.Deadline(); ok && requestedDeadline.Before(deadline) {
		deadline = requestedDeadline
	}
	dialer := &net.Dialer{Timeout: time.Until(deadline)}
	var conn net.Conn
	var err error
	if strings.EqualFold(settings.EncryptType, "SSL") || strings.EqualFold(settings.EncryptType, "TLS") {
		conn, err = (&tls.Dialer{NetDialer: dialer, Config: &tls.Config{ServerName: settings.Host, MinVersion: tls.VersionTLS12}}).DialContext(ctx, "tcp", addr)
	} else {
		conn, err = dialer.DialContext(ctx, "tcp", addr)
	}
	if err != nil {
		return err
	}
	defer conn.Close()
	if err := conn.SetDeadline(deadline); err != nil {
		return err
	}
	client, err := smtp.NewClient(conn, settings.Host)
	if err != nil {
		return err
	}
	defer client.Quit()
	if strings.EqualFold(settings.EncryptType, "STARTTLS") {
		if ok, _ := client.Extension("STARTTLS"); !ok {
			return fmt.Errorf("SMTP server does not support STARTTLS")
		}
		if err := client.StartTLS(&tls.Config{ServerName: settings.Host, MinVersion: tls.VersionTLS12}); err != nil {
			return err
		}
	}
	if auth != nil {
		if err := client.Auth(auth); err != nil {
			return err
		}
	}
	if err := client.Mail(settings.FromEmail); err != nil {
		return err
	}
	if err := client.Rcpt(to); err != nil {
		return err
	}
	writer, err := client.Data()
	if err != nil {
		return err
	}
	if _, err := writer.Write(message); err != nil {
		return err
	}
	return writer.Close()
}

func mimeHeader(value string) string {
	return "=?UTF-8?B?" + base64.StdEncoding.EncodeToString([]byte(value)) + "?="
}
