import { parseResume, type Resume } from '../content/resume.ts';
import { readOptionalYaml } from './yaml.ts';

/** Name of the resume data file in a resume bundle. */
export const RESUME_FILE = '_resume.yaml';

/** The resume data kept next to the resume page; null when the file is missing, empty or not a mapping. Every warning carries the `resume:` prefix. */
export async function readResume(
  file: string,
  now: Date,
): Promise<{ resume: Resume | null; warnings: readonly string[] }> {
  const { data, warnings } = await readOptionalYaml(file);
  const parsed = data == null ? { resume: null, warnings: [] } : parseResume(data, now);
  return {
    resume: parsed.resume,
    warnings: [...warnings, ...parsed.warnings].map((msg) => `resume: ${msg}`),
  };
}
