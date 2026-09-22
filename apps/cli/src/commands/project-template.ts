/** A flat file name and its UTF-8 content. */
export interface ProjectTemplateFile {
  readonly name: string;
  readonly content: string;
}

export const PROJECT_TEMPLATE_MAX_FILES = 8;
export const PROJECT_TEMPLATE_MAX_BYTES = 64 * 1024;
export const PROJECT_TEMPLATE: readonly ProjectTemplateFile[] = []; // Task 15 fills it
