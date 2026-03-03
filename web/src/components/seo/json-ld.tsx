const siteUrl = "https://www.forkscout.com";

const websiteSchema = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "ForkScout",
    url: siteUrl,
    description:
        "Self-hosted autonomous AI agent with real tools, persistent memory, multi-channel presence, and the ability to modify and restart itself.",
    potentialAction: {
        "@type": "SearchAction",
        target: `${siteUrl}/?q={search_term_string}`,
        "query-input": "required name=search_term_string",
    },
};

const organizationSchema = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "ForkScout",
    url: siteUrl,
    logo: `${siteUrl}/logo.svg`,
    sameAs: [
        "https://github.com/marsnext/forkscout",
    ],
};

const softwareSchema = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "ForkScout",
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Linux, macOS, Windows (Docker)",
    url: siteUrl,
    downloadUrl: "https://github.com/marsnext/forkscout",
    description:
        "Open-source autonomous AI agent with shell access, web browsing, file I/O, persistent memory, and multi-channel presence.",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    author: { "@type": "Organization", name: "Martian Academy", url: siteUrl },
};

const siteNavSchema = {
    "@context": "https://schema.org",
    "@type": "SiteNavigationElement",
    name: [
        "Features",
        "Use Cases",
        "Tech Stack",
        "Providers",
        "Get Started",
    ],
    url: [
        `${siteUrl}/#features`,
        `${siteUrl}/#use-cases`,
        `${siteUrl}/#tech-stack`,
        `${siteUrl}/#providers`,
        `${siteUrl}/#get-started`,
    ],
};

export function JsonLd() {
    return (
        <>
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteSchema) }}
            />
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
            />
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareSchema) }}
            />
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(siteNavSchema) }}
            />
        </>
    );
}
