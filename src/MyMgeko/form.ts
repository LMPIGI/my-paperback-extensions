import {
  Form,
  FormSectionElement,
  NavigationRow,
  Section,
  SelectRow,
} from "@paperback/types";
import { getGenreFilter, getMangaTypeFilter } from "./helpers";

/** Root settings form shown in Paperback → Source settings */
export class Forms extends Form {
  override getSections(): FormSectionElement[] {
    return [
      Section("content", [
        NavigationRow("content_settings", {
          title: "Content",
          subtitle: "Hide / Defaults",
          form: new FilterSettings(),
        }),
      ]),
    ];
  }
}

/** Sub-form with the actual selectable options */
class FilterSettings extends Form {
  // Paperback SelectRow expects { id, title } style options
  genres = getGenreFilter().map(({ value, ...rest }) => ({
    title: value,
    ...rest,
  }));

  mangaTypes = getMangaTypeFilter().map(({ value, ...rest }) => ({
    title: value,
    ...rest,
  }));

  private async updateValue(value: string[], key: string): Promise<void> {
    Application.setState(value, key);
    console.log(`[SETTINGS] Updated ${key}: [${value.join(", ")}]`);
    this.reloadForm();
    Application.invalidateSearchFilters(); // refresh filters shown in search UI
  }

  override getSections(): FormSectionElement[] {
    const sections: FormSectionElement[] = [];

    // Hide controls (only render if we actually have options)
    if (this.genres.length || this.mangaTypes.length) {
      sections.push(
        Section(
          {
            id: "hide_controls",
            footer:
              "Hidden items may still appear in some lists. They will also be filtered out from search results.",
          },
          [
            ...(this.genres.length
              ? [
                  SelectRow("hide_tags", {
                    title: "Hide Genres",
                    subtitle: "Exclude selected genres from results",
                    value: this.getHideTags(),
                    options: this.genres,
                    minItemCount: 0,
                    maxItemCount: this.genres.length,
                    onValueChange: Application.Selector(
                      this as FilterSettings,
                      "handleHideTagsChange",
                    ),
                  }),
                ]
              : []),
            ...(this.mangaTypes.length
              ? [
                  SelectRow("hide_type", {
                    title: "Hide Types",
                    subtitle: "Exclude selected types from results",
                    value: this.getHideTypes(),
                    options: this.mangaTypes,
                    minItemCount: 0,
                    maxItemCount: this.mangaTypes.length,
                    onValueChange: Application.Selector(
                      this as FilterSettings,
                      "handleHideTypesChange",
                    ),
                  }),
                ]
              : []),
          ],
        ),
      );
    }

    // Defaults (ex: default selected type in search)
    if (this.mangaTypes.length) {
      sections.push(
        Section(
          { id: "default_controls", footer: "Default filters for search." },
          [
            SelectRow("def_type", {
              title: "Default Type",
              subtitle: "Applied automatically in new searches",
              value: this.getDefaultType(),
              options: this.mangaTypes,
              minItemCount: 0,
              maxItemCount: 1,
              onValueChange: Application.Selector(
                this as FilterSettings,
                "handleDefaultTypeChange",
              ),
            }),
          ],
        ),
      );
    }

    return sections;
  }

  // --- state getters
  private getHideTags(): string[] {
    return (Application.getState("hide_tags") as string[] | undefined) ?? [];
  }
  private getHideTypes(): string[] {
    return (Application.getState("hide_type") as string[] | undefined) ?? [];
  }
  private getDefaultType(): string[] {
    return (Application.getState("def_type") as string[] | undefined) ?? [];
  }

  // --- handlers (wired above with Application.Selector)
  async handleHideTagsChange(value: string[]): Promise<void> {
    await this.updateValue(value, "hide_tags");
  }
  async handleHideTypesChange(value: string[]): Promise<void> {
    await this.updateValue(value, "hide_type");
  }
  async handleDefaultTypeChange(value: string[]): Promise<void> {
    await this.updateValue(value, "def_type");
  }
}
