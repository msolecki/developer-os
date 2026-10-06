/** `npm run render:claude`: regenerate `plugins/claude/` (see `render-plugin.ts`). Never imported. */
import { stdout } from "node:process";

import { GENERATED_ROOT, renderAllForClaude } from "../contracts/adapters/claude/render-all.js";
import { regenerate } from "./render-plugin.js";

const written = await regenerate({ render: () => renderAllForClaude(), generatedRoot: GENERATED_ROOT });
stdout.write(`wrote ${String(written)} artifacts to plugins/claude\n`);
