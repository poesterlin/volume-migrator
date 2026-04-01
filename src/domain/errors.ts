export enum ExitCode {
  Success = 0,
  GeneralError = 1,
  UserAbort = 2,
  PreflightFailed = 3,
  MatchingFailed = 4,
  TransferFailed = 5,
  VerificationFailed = 6,
}

export type CliErrorPayload = {
  code: string;
  humanMessage: string;
  technicalDetails?: string;
  remediationHint?: string;
  exitCode?: ExitCode;
};

export class CliError extends Error {
  public readonly code: string;
  public readonly humanMessage: string;
  public readonly technicalDetails?: string;
  public readonly remediationHint?: string;
  public readonly exitCode: ExitCode;

  constructor(payload: CliErrorPayload) {
    super(payload.humanMessage);
    this.name = "CliError";
    this.code = payload.code;
    this.humanMessage = payload.humanMessage;
    this.technicalDetails = payload.technicalDetails;
    this.remediationHint = payload.remediationHint;
    this.exitCode = payload.exitCode ?? ExitCode.GeneralError;
  }
}

export class UserAbortError extends CliError {
  constructor(message = "Aborted by user.") {
    super({
      code: "USER_ABORT",
      humanMessage: message,
      exitCode: ExitCode.UserAbort,
    });
    this.name = "UserAbortError";
  }
}

export class DiscoveryError extends CliError {
  constructor(payload: Omit<CliErrorPayload, "exitCode">) {
    super({ ...payload, exitCode: ExitCode.GeneralError });
    this.name = "DiscoveryError";
  }
}

export class MatchingError extends CliError {
  constructor(payload: Omit<CliErrorPayload, "exitCode">) {
    super({ ...payload, exitCode: ExitCode.MatchingFailed });
    this.name = "MatchingError";
  }
}

export class TransferError extends CliError {
  constructor(payload: Omit<CliErrorPayload, "exitCode">) {
    super({ ...payload, exitCode: ExitCode.TransferFailed });
    this.name = "TransferError";
  }
}
