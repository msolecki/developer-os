declare const __DEVELOPER_OS_RELEASE_VERSION__: string | undefined;
/** The release version, stamped by the release packer's esbuild `define` (Task 11b); "0.0.0" in an unpacked build. */
export const RELEASE_VERSION: string = typeof __DEVELOPER_OS_RELEASE_VERSION__ === "string" ? __DEVELOPER_OS_RELEASE_VERSION__ : "0.0.0";
