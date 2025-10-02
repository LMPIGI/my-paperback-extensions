import { ContentRating, SourceInfo, SourceIntents } from "@paperback/types";

export default {
  // bump this whenever you ship changes
  version: "1.0.0",

  // how it appears in Paperback
  name: "Mgeko",
  description: "Extension that pulls books from your Mgeko site.",
  icon: "mgeko.png",                     // <-- file must be in ./static/

  // locale / rating
  language: "en",
  contentRating: ContentRating.EVERYONE,

  // tell Paperback what this source supports
  capabilities: [
    SourceIntents.MANGA_SEARCH,          // getSearchResults(...)
    SourceIntents.MANGA_CHAPTERS,        // getChapters(...) + getChapterDetails(...)
    SourceIntents.DISCOVER_SECIONS,      // getDiscoverSections(...), getDiscoverSectionItems(...)
    SourceIntents.SETTINGS_UI            // getSettingsForm(...)
    // If you also expose a dedicated details route, add:
    // SourceIntents.MANGA_INFO
  ],

  // optional flair in the repo UI
  badges: [
    {
      label: "Official",
      textColor: "#ffffff",
      backgroundColor: "#53c2ae"
    }
  ],

  // credits
  developers: [
    {
      name: "LMPIGI",
      website: "https://www.mgeko.cc"
    }
  ]
} satisfies SourceInfo;
