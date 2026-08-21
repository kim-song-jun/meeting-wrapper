import { readExpectedToolchain, verifyToolchain } from "./lib/toolchain-policy.mjs";

const npm = /(?:^| )npm\/(\d+\.\d+\.\d+)(?: |$)/.exec(process.env.npm_config_user_agent ?? "")?.[1];
if (!npm) throw new Error("npm version is unavailable; run this command through npm");
verifyToolchain(readExpectedToolchain(process.cwd()), { node: process.versions.node, npm });
console.log("MolRoom toolchain: valid");
