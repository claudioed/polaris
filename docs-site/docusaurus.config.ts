import { themes as prismThemes } from "prism-react-renderer";
import type * as Preset from "@docusaurus/preset-classic";
import type { Config } from "@docusaurus/types";
import type * as OpenApiPlugin from "docusaurus-plugin-openapi-docs";

const config: Config = {
  title: "Polaris",
  tagline: "Architectural fitness-function control plane",
  favicon: "img/favicon.svg",

  url: "https://claudioed.github.io",
  baseUrl: "/polaris/",

  organizationName: "claudioed",
  projectName: "polaris",

  onBrokenLinks: "throw",
  onBrokenMarkdownLinks: "warn",

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  presets: [
    [
      "classic",
      {
        docs: {
          routeBasePath: "/",
          sidebarPath: "./sidebars.ts",
          docItemComponent: "@theme/ApiItem",
          editUrl: "https://github.com/claudioed/polaris/tree/main/docs-site/",
        },
        blog: false,
        theme: {
          customCss: "./src/css/custom.css",
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      defaultMode: "dark",
      disableSwitch: false,
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: "Polaris",
      logo: {
        alt: "Polaris logo",
        src: "img/logo.svg",
      },
      items: [
        { type: "doc", docId: "introduction/overview", label: "Docs" },
        { type: "doc", docId: "modules/architecture", label: "Modules" },
        { to: "api/polaris-api", label: "API" },
        {
          href: "https://github.com/claudioed/polaris",
          label: "GitHub",
          position: "right",
        },
      ],
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "Docs",
          items: [
            { label: "Overview", to: "/" },
            { label: "Getting started", to: "/introduction/getting-started" },
            { label: "Architecture", to: "/modules/architecture" },
          ],
        },
        {
          title: "API",
          items: [
            { label: "REST reference", to: "/api/polaris-api" },
            { label: "OpenAPI spec", href: "https://github.com/claudioed/polaris/blob/main/api/openapi.yaml" },
            { label: "Domain spec", href: "https://github.com/claudioed/polaris/blob/main/polaris.md" },
          ],
        },
        {
          title: "Project",
          items: [
            { label: "GitHub", href: "https://github.com/claudioed/polaris" },
            { label: "Control tower", href: "https://github.com/claudioed/polaris/tree/main/web" },
            { label: "CI", href: "https://github.com/claudioed/polaris/actions" },
          ],
        },
      ],
      copyright: `Copyright ${new Date().getFullYear()} Polaris maintainers. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ["yaml", "go", "sql", "bash", "json"],
    },
    api: {
      authPersistance: false,
    },
  } satisfies Preset.ThemeConfig,

  plugins: [
    [
      "docusaurus-plugin-openapi-docs",
      {
        id: "openapi",
        docsPluginId: "classic",
        config: {
          polaris: {
            specPath: "../api/openapi.yaml",
            outputDir: "docs/api",
            showExtensions: true,
            sidebarOptions: {
              groupPathsBy: "tag",
              categoryLinkSource: "tag",
              sidebarCollapsible: true,
              sidebarCollapsed: true,
            },
          } satisfies OpenApiPlugin.Options,
        },
      },
    ],
  ],

  themes: ["docusaurus-theme-openapi-docs"],
};

export default config;
