"use client";

import { Table, Tag, TagGroup } from "@heroui/react";
import { Activity, CheckCircle2, Clock3, FileKey2, UploadCloud } from "lucide-react";
import { useLocale } from "@/components/providers/locale-provider";
import { marketingCopy } from "@/lib/marketing-copy";

export function MarketingConsolePreview() {
  const { locale } = useLocale();
  const copy = marketingCopy[locale].preview;
  const rows = [
    {
      name: "example.com",
      domains: "*.example.com, example.com",
      status: copy.statuses[0],
      expiry: copy.expiry[0],
    },
    { name: "api.example.com", domains: "api.example.com", status: copy.statuses[1], expiry: copy.expiry[1] },
  ];

  return (
    <div className="marketing-preview" aria-label="CertFlow console preview">
      <div className="marketing-preview-chrome">
        <div className="marketing-preview-wordmark">
          <span>
            <FileKey2 size={15} />
          </span>
          CertFlow
        </div>
        <div className="marketing-preview-avatar" aria-hidden="true">
          CF
        </div>
      </div>
      <div className="marketing-preview-body">
        <aside className="marketing-preview-sidebar" aria-hidden="true">
          <span className="is-active">
            <Activity size={15} />
            {copy.overview}
          </span>
          <span>
            <FileKey2 size={15} />
            {copy.certificates}
          </span>
          <span>
            <UploadCloud size={15} />
            {copy.automation}
          </span>
        </aside>
        <section className="marketing-preview-content">
          <div className="marketing-preview-title-row">
            <div>
              <p>{copy.area}</p>
              <h2>{copy.title}</h2>
            </div>
            <span className="marketing-preview-create">{copy.create}</span>
          </div>
          <div className="marketing-preview-metrics">
            <div>
              <span>{copy.metrics[0][0]}</span>
              <strong>12</strong>
              <small>{copy.metrics[0][1]}</small>
            </div>
            <div>
              <span>{copy.metrics[1][0]}</span>
              <strong>2</strong>
              <small>{copy.metrics[1][1]}</small>
            </div>
            <div>
              <span>{copy.metrics[2][0]}</span>
              <strong>1</strong>
              <small>{copy.metrics[2][1]}</small>
            </div>
          </div>
          <div className="marketing-preview-table-wrap">
            <Table className="marketing-preview-table" variant="secondary">
              <Table.ScrollContainer>
                <Table.Content aria-label="Certificate status preview" className="min-w-[500px]">
                  <Table.Header>
                    <Table.Column isRowHeader>{copy.headers[0]}</Table.Column>
                    <Table.Column>{copy.headers[1]}</Table.Column>
                    <Table.Column>{copy.headers[2]}</Table.Column>
                  </Table.Header>
                  <Table.Body>
                    {rows.map((row) => (
                      <Table.Row key={row.name}>
                        <Table.Cell>
                          <strong>{row.name}</strong>
                          <small>{row.domains}</small>
                        </Table.Cell>
                        <Table.Cell>
                          <TagGroup aria-label="状态" size="sm">
                            <TagGroup.List>
                              <Tag
                                id={`certificate-status-${row.name}`}
                                className={
                                  row.status === copy.statuses[0]
                                    ? "marketing-preview-status-success"
                                    : "marketing-preview-status-progress"
                                }
                              >
                                {row.status === copy.statuses[0] ? (
                                  <CheckCircle2 size={12} />
                                ) : (
                                  <Clock3 size={12} />
                                )}
                                {row.status}
                              </Tag>
                            </TagGroup.List>
                          </TagGroup>
                        </Table.Cell>
                        <Table.Cell>{row.expiry}</Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Content>
              </Table.ScrollContainer>
            </Table>
          </div>
        </section>
      </div>
    </div>
  );
}
