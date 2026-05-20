import os from "os";
import path from "path";

export const APP_NAME = "VrSrc CLI";
export const APP_HOME = path.join(os.homedir(), ".vrsrc-cli");
export const DATA_HOME = path.join(APP_HOME, "data");
export const META_ARCHIVE = path.join(DATA_HOME, "meta.7z");
export const CONFIG_PATH = path.join(APP_HOME, "config.json");
export const TRAFFIC_LOG_PATH = path.join(APP_HOME, "traffic.log");
export const SERVER_INFO_DEFAULT = path.join(APP_HOME, "ServerInfo.json");

export const GAME_LIST_SUFFIX = /amelist\.txt$/i;
export const originInfoCache = new Map();
