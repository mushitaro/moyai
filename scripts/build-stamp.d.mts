// scripts/build-stamp.mjs の型（設定のファイルが TS から読むため）。
export type BuildStamp = { time: string; commit: string };
export declare function buildStamp(now?: Date): BuildStamp;
export declare const STAMP_ENV: string;
export declare function sharedBuildStamp(env?: Record<string, string | undefined>): BuildStamp;
