export function createAccessState({ approvalPolicy, sandboxPolicy }) {
  return {
    defaultApprovalPolicy: approvalPolicy ?? "never",
    defaultSandboxPolicy: sandboxPolicy ?? { type: "dangerFullAccess" },
    overrideApprovalPolicy: null,
    overrideSandboxPolicy: null,
  };
}

export function resolveEffectiveAccess(accessState) {
  if (!accessState) {
    return {
      approvalPolicy: "never",
      sandboxPolicy: { type: "dangerFullAccess" },
    };
  }

  return {
    approvalPolicy: accessState.overrideApprovalPolicy ?? accessState.defaultApprovalPolicy ?? "never",
    sandboxPolicy: accessState.overrideSandboxPolicy ?? accessState.defaultSandboxPolicy ?? { type: "dangerFullAccess" },
  };
}

export function applyPermissionLevel({ level, accessState, cwd }) {
  const nextAccessState = {
    ...createAccessState(resolveEffectiveAccess(accessState)),
    defaultApprovalPolicy: accessState?.defaultApprovalPolicy ?? "never",
    defaultSandboxPolicy: accessState?.defaultSandboxPolicy ?? { type: "dangerFullAccess" },
    overrideApprovalPolicy: null,
    overrideSandboxPolicy: null,
  };

  if (level === "default") {
    return nextAccessState;
  }

  if (level === "full") {
    return {
      ...nextAccessState,
      overrideApprovalPolicy: "never",
      overrideSandboxPolicy: { type: "dangerFullAccess" },
    };
  }

  if (level === "readonly") {
    return {
      ...nextAccessState,
      overrideApprovalPolicy: "on-request",
      overrideSandboxPolicy: {
        type: "readOnly",
        access: { type: "fullAccess" },
        networkAccess: getEffectiveNetworkAccess(accessState),
      },
    };
  }

  if (level === "workspace") {
    return {
      ...nextAccessState,
      overrideApprovalPolicy: "on-request",
      overrideSandboxPolicy: {
        type: "workspaceWrite",
        writableRoots: cwd ? [cwd] : [],
        readOnlyAccess: { type: "fullAccess" },
        networkAccess: getEffectiveNetworkAccess(accessState),
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      },
    };
  }

  throw new Error(`Unknown permission level: ${level}`);
}

export function describeAccessSummary(accessState) {
  const { approvalPolicy, sandboxPolicy } = resolveEffectiveAccess(accessState);
  const level = detectPermissionLevel({ approvalPolicy, sandboxPolicy });
  return `${level} (approval: ${formatApprovalPolicy(approvalPolicy)}, sandbox: ${formatSandboxPolicy(sandboxPolicy)})`;
}

export function detectPermissionLevel({ approvalPolicy, sandboxPolicy }) {
  const sandboxType = sandboxPolicy?.type ?? "unknown";
  if (sandboxType === "dangerFullAccess" && approvalPolicy === "never") {
    return "full";
  }
  if (sandboxType === "workspaceWrite") {
    return "workspace";
  }
  if (sandboxType === "readOnly") {
    return "readonly";
  }
  return "custom";
}

function formatApprovalPolicy(approvalPolicy) {
  if (typeof approvalPolicy === "string") {
    return approvalPolicy;
  }
  return "custom";
}

function formatSandboxPolicy(sandboxPolicy) {
  return sandboxPolicy?.type ?? "unknown";
}

function getEffectiveNetworkAccess(accessState) {
  const { sandboxPolicy } = resolveEffectiveAccess(accessState);
  if (typeof sandboxPolicy?.networkAccess === "boolean") {
    return sandboxPolicy.networkAccess;
  }
  if (typeof sandboxPolicy?.networkAccess === "string") {
    return sandboxPolicy.networkAccess === "enabled";
  }
  return true;
}
