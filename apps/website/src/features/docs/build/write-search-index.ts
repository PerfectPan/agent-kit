import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createFromSource } from "fumadocs-core/search/server";

import { i18nSearchData } from "../search-export.ts";
import { source } from "../source.ts";

const searchDir = join(process.cwd(), "dist/.search");

let pending: Promise<void> | undefined;

/**
 * One static index per language. `localeMap` makes Fumadocs export a separate
 * database for each locale instead of one i18n-filtered file.
 */
export function writeSearchIndexes(): Promise<void> {
  pending ??= (async () => {
    try {
      const data = i18nSearchData(
        await createFromSource(source, {
          localeMap: {
            en: {},
            zh: {}
          }
        }).export()
      );
      mkdirSync(searchDir, { recursive: true });
      for (const lang of ["en", "zh"] as const) {
        const index = data[lang];
        if (index === undefined) {
          throw new Error(`missing search index for ${lang}`);
        }
        writeFileSync(join(searchDir, `search.${lang}.json`), JSON.stringify(index));
      }
    } catch (error) {
      console.error("writeSearchIndexes failed", error);
      throw error;
    }
  })();
  return pending;
}
