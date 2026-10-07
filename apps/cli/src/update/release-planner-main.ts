import { decodePlannerInput, encodePlannerOutput, planKeepAllRelease } from "@developer-os/core/planner-protocol";

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
try {
  const { request } = decodePlannerInput(new Uint8Array(Buffer.concat(chunks)));
  process.stdout.write(encodePlannerOutput(request, planKeepAllRelease(request), []));
} catch {
  process.exitCode = 3;
}
