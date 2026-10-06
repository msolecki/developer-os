/** `npm run render:claude`: regenerate `plugins/claude/` (see `render-plugin.ts`). Importing it does nothing. */
import { argv, stdout } from "node:process";

import { GENERATED_ROOT, renderAllForClaude } from "../contracts/adapters/claude/render-all.js";
import { isEntryPoint, regenerate } from "./render-plugin.js";

if (isEntryPoint(argv[1], import.meta.url)) {
  const written = await regenerate({ render: () => renderAllForClaude(), generatedRoot: GENERATED_ROOT });
  stdout.write(`wrote ${String(written)} artifacts to plugins/claude\n`);
}
