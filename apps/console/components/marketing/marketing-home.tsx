"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2, Languages, Menu, ShieldCheck } from "lucide-react";
import { Dropdown } from "@heroui/react";
import { MarketingCapabilities } from "@/components/marketing/marketing-capabilities";
import { MarketingConsolePreview } from "@/components/marketing/marketing-console-preview";
import { MarketingHeroPreviewMotion, MarketingReveal } from "@/components/marketing/marketing-motion";
import { MarketingWorkflow } from "@/components/marketing/marketing-workflow";
import { useLocale, type Locale } from "@/components/providers/locale-provider";
import { BrandLogo } from "@/components/ui/brand-logo";
import {
  documentationUrl,
  licenseUrl,
  marketingCopy,
  quickStartUrl,
  repositoryUrl,
} from "@/lib/marketing-copy";

function MarketingHeader() {
  const { locale, setLocale } = useLocale();
  const copy = marketingCopy[locale];

  function navigate(key: React.Key) {
    document.querySelector(String(key))?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <header className="marketing-header">
      <div className="marketing-container marketing-nav">
        <Link className="marketing-brand" href="/" aria-label="CertFlow home">
          <BrandLogo variant="marketing" priority />
        </Link>
        <nav className="marketing-nav-links" aria-label="Product navigation">
          <a href="#capabilities">{copy.nav.capabilities}</a>
          <a href="#workflow">{copy.nav.workflow}</a>
          <a href="#open-source">{copy.nav.deployment}</a>
        </nav>
        <div className="marketing-nav-actions">
          <Dropdown>
            <Dropdown.Trigger className="marketing-language-trigger" aria-label="Change language">
              <Languages size={16} /> <span>{locale === "zh-CN" ? "中" : "EN"}</span>
            </Dropdown.Trigger>
            <Dropdown.Popover placement="bottom end">
              <Dropdown.Menu
                selectedKeys={[locale]}
                selectionMode="single"
                onAction={(key) => setLocale(String(key) as Locale)}
              >
                <Dropdown.Item id="zh-CN">简体中文</Dropdown.Item>
                <Dropdown.Item id="en">English</Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
          <Link className="marketing-login-link" href="/login">
            {copy.nav.login}
          </Link>
          <Link className="marketing-button marketing-button-primary marketing-header-cta" href="/login">
            {copy.nav.console} <ArrowRight size={16} />
          </Link>
          <Dropdown>
            <Dropdown.Trigger className="marketing-mobile-menu-trigger" aria-label={copy.mobileMenu}>
              <Menu size={18} />
            </Dropdown.Trigger>
            <Dropdown.Popover placement="bottom end">
              <Dropdown.Menu onAction={navigate}>
                <Dropdown.Item id="#capabilities">{copy.nav.capabilities}</Dropdown.Item>
                <Dropdown.Item id="#workflow">{copy.nav.workflow}</Dropdown.Item>
                <Dropdown.Item id="#open-source">{copy.nav.deployment}</Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        </div>
      </div>
    </header>
  );
}

export function MarketingHome() {
  const { locale } = useLocale();
  const copy = marketingCopy[locale];
  const [heroLineOne, heroLineTwo] = copy.hero.title.split("<br />");

  return (
    <main className="marketing-page">
      <MarketingHeader />
      <section className="marketing-hero">
        <div className="marketing-container marketing-hero-grid">
          <MarketingReveal className="marketing-hero-copy">
            <p className="marketing-eyebrow">{copy.hero.eyebrow}</p>
            <h1>
              {heroLineOne}
              <br />
              {heroLineTwo}
            </h1>
            <p className="marketing-hero-description">{copy.hero.description}</p>
            <div className="marketing-hero-actions">
              <Link className="marketing-button marketing-button-primary" href="/login">
                {copy.nav.console} <ArrowRight size={17} />
              </Link>
              <a className="marketing-button marketing-button-secondary" href="#workflow">
                {copy.hero.workflow}
              </a>
            </div>
          </MarketingReveal>
          <MarketingHeroPreviewMotion>
            <MarketingConsolePreview />
          </MarketingHeroPreviewMotion>
        </div>
      </section>

      <section className="marketing-trust" aria-label={copy.coverage.label}>
        <div className="marketing-container marketing-trust-content">
          <span>{copy.coverage.label}</span>
          <div className="marketing-trust-list">
            {copy.coverage.items.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        </div>
      </section>

      <section className="marketing-section marketing-capabilities" id="capabilities">
        <div className="marketing-container">
          <div className="marketing-section-heading">
            <p className="marketing-eyebrow">{copy.capabilities.eyebrow}</p>
            <h2>{copy.capabilities.title}</h2>
            <p>{copy.capabilities.description}</p>
          </div>
          <MarketingCapabilities />
        </div>
      </section>

      <section className="marketing-section marketing-workflow-section" id="workflow">
        <div className="marketing-container marketing-workflow-layout">
          <div className="marketing-workflow-intro">
            <p className="marketing-eyebrow">{copy.workflow.eyebrow}</p>
            <h2>{copy.workflow.title}</h2>
            <p>{copy.workflow.description}</p>
            <a className="marketing-text-link" href="#open-source">
              {copy.workflow.deployment} <ArrowRight size={16} />
            </a>
          </div>
          <MarketingWorkflow />
        </div>
      </section>

      <section className="marketing-section marketing-operations" aria-label={copy.operations.title}>
        <div className="marketing-container marketing-operations-grid">
          <article>
            <span className="marketing-large-icon">
              <ShieldCheck size={28} strokeWidth={1.7} />
            </span>
            <h2>{copy.operations.title}</h2>
            <p>{copy.operations.description}</p>
          </article>
          <article className="marketing-operation-checklist">
            {copy.operations.items.map((item) => (
              <div key={item}>
                <CheckCircle2 size={18} /> {item}
              </div>
            ))}
          </article>
        </div>
      </section>

      <section className="marketing-section marketing-open-source" id="open-source">
        <div className="marketing-container marketing-open-source-content">
          <div>
            <p className="marketing-eyebrow">{copy.openSource.eyebrow}</p>
            <h2>{copy.openSource.title}</h2>
            <p>{copy.openSource.description}</p>
          </div>
          <div className="marketing-open-source-actions">
            <a
              className="marketing-button marketing-button-secondary"
              href={repositoryUrl}
              target="_blank"
              rel="noreferrer"
            >
              {copy.openSource.github} <ArrowRight size={17} />
            </a>
            <a
              className="marketing-button marketing-button-primary"
              href={quickStartUrl}
              target="_blank"
              rel="noreferrer"
            >
              {copy.openSource.quickStart} <ArrowRight size={17} />
            </a>
          </div>
        </div>
      </section>

      <footer className="marketing-footer">
        <div className="marketing-container">
          <div>
            <BrandLogo variant="footer" />
            <span>{copy.footer.description}</span>
          </div>
          <nav aria-label="Footer navigation">
            <a href={repositoryUrl} target="_blank" rel="noreferrer">
              GitHub
            </a>
            <a href={documentationUrl} target="_blank" rel="noreferrer">
              {copy.footer.docs}
            </a>
            <a href={licenseUrl} target="_blank" rel="noreferrer">
              {copy.footer.license}
            </a>
          </nav>
        </div>
      </footer>
    </main>
  );
}
