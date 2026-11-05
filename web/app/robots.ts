import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://ai-hedge-cockpit.local";

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/data/"],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
