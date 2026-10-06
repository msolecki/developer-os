/** `npm run render:codex`: regenerate `plugins/codex/` (see `render-plugin.ts`). Never imported. */
import { stdout } from "node:process";

import { GENERATED_ROOT, renderAllForCodex } from "../contracts/adapters/codex/render-all.js";
import { regenerate } from "./render-plugin.js";

const written = await regenerate({ render: () => renderAllForCodex(), generatedRoot: GENERATED_ROOT });
stdout.write(`wrote ${String(written)} artifacts to plugins/codex\n`);
