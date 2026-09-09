/** What this plugin is called, and how it names the documents it ships. */
export const ROOT = '@http';

/** A document of this plugin, by its path under the root. */
export const doc = (file: string) => `${ROOT}/${file}`;
