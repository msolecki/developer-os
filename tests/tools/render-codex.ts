/** `npm run render:codex`: regenerate `plugins/codex/` (see `render-plugin.ts`). Importing it does nothing. */
import { argv, stdout } from "node:process";

import { GENERATED_ROOT, renderAllForCodex } from "../contracts/adapters/codex/render-all.js";
import { isEntryPoint, regenerate } from "./render-plugin.js";

if (isEntryPoint(argv[1], import.meta.url)) {
  const written = await regenerate({ render: () => renderAllForCodex(), generatedRoot: GENERATED_ROOT });
  stdout.write(`wrote ${String(written)} artifacts to plugins/codex\n`);
}
