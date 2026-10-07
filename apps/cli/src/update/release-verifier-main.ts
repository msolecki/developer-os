import { decodePlannerJson, PLANNER_WIRE_BOUNDS_V1, plannerJsonBytes, PlannerWireDecoder, PlannerWireEncoder, verifyTargetSnapshot } from "@developer-os/core/planner-protocol";

const decoder = new PlannerWireDecoder("input", PLANNER_WIRE_BOUNDS_V1);
let request: unknown = null;
try {
  for await (const chunk of process.stdin) {
    for (const frame of decoder.push(new Uint8Array(chunk as Buffer))) {
      if (frame.kind === "json") request = decodePlannerJson(frame.payload, frame.payload.byteLength);
    }
  }
  const { snapshot } = request as { readonly snapshot: { readonly manifest: string; readonly owners: Parameters<typeof verifyTargetSnapshot>[0]["owners"]; readonly migrations: Parameters<typeof verifyTargetSnapshot>[0]["migrations"] } };
  const payload = plannerJsonBytes(verifyTargetSnapshot({ manifest: new Uint8Array(Buffer.from(snapshot.manifest, "base64")), owners: snapshot.owners, migrations: snapshot.migrations }));
  const encoder = new PlannerWireEncoder("output", PLANNER_WIRE_BOUNDS_V1);
  process.stdout.write(Buffer.concat([encoder.magic(), encoder.json(payload), payload, encoder.end()]));
} catch {
  process.exitCode = 3;
}
