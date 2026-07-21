export interface DeveloperOsConfigV1 {
  readonly schemaVersion: 1;
  readonly brainPath: string;
  readonly adapters: {
    readonly claude: boolean;
    readonly codex: boolean;
  };
  readonly git: {
    readonly enabled: boolean;
  };
  readonly automation: {
    readonly enabled: boolean;
  };
  readonly telemetry: false;
}

export interface RuntimePaths {
  readonly home: string;
  readonly configFile: string;
  readonly manifestFile: string;
  readonly stateDir: string;
  readonly stagingDir: string;
  readonly backupsDir: string;
  readonly logsDir: string;
  readonly brain: string;
}

export interface PathEnvironment {
  readonly HOME: string;
  readonly DEVELOPER_OS_HOME?: string;
  readonly DEVELOPER_OS_BRAIN?: string;
}
