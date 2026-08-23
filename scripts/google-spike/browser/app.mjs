import { createGoogleFetch } from "/google-fetch.mjs";

(() => {
  "use strict";

  const PLACEHOLDER_CLIENT_ID = "replace-with-public-browser-client-id";
  const SAFE_CANDIDATE_SHA = "0123456789abcdef0123456789abcdef01234567";
  const SAFE_ENDPOINT = "https://www.googleapis.com/calendar/v3/calendars/{calendar}/events";
  const GOOGLE_SCOPES = Object.freeze([
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/drive.appdata",
  ]);
  const CONFIG_KEYS = Object.freeze([
    "schemaVersion",
    "googleClientId",
    "accountAliases",
    "roomCalendars",
  ]);
  const ALIAS_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
  const CLIENT_ID_PATTERN = /^\d{6,}-[a-z0-9]+\.apps\.googleusercontent\.com$/;

  const elements = Object.freeze({
    statusPanel: requireElement("status-panel"),
    status: requireElement("status"),
    error: requireElement("error"),
    connect: requireElement("connect-google"),
    connectReason: requireElement("connect-reason"),
    reconnect: requireElement("reconnect-google"),
    reconnectReason: requireElement("reconnect-reason"),
    revoke: requireElement("revoke-google"),
    revokeReason: requireElement("revoke-reason"),
    probeSelect: requireElement("probe-select"),
    runProbe: requireElement("run-probe"),
    runReason: requireElement("run-reason"),
    exportEvidence: requireElement("export-evidence"),
    exportReason: requireElement("export-reason"),
    teardown: requireElement("teardown"),
    teardownReason: requireElement("teardown-reason"),
    accountAliases: requireElement("account-aliases"),
    roomAliases: requireElement("room-aliases"),
  });

  const googleFetch = createGoogleFetch();
  const activeRequests = new Set();
  const acceptedEvidence = [];

  let publicConfig = null;
  let configState = "loading";
  let gisState = globalThis.google?.accounts?.oauth2 ? "ready" : "loading";
  let tokenClient = null;
  let accessToken = null;
  let accessTokenExpiresAt = 0;
  let hasConnected = false;
  let authBusy = false;
  let probeBusy = false;
  let lifecycleRevision = 0;
  let runCounter = 0;

  function requireElement(id) {
    const element = document.getElementById(id);
    if (element === null) throw new Error("PROBE_MARKUP_INCOMPLETE");
    return element;
  }

  function isPlainRecord(value) {
    return (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype
    );
  }

  function exactKeys(value, keys) {
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
  }

  function validAlias(value) {
    return typeof value === "string" && ALIAS_PATTERN.test(value);
  }

  function validConfigString(value, max) {
    return (
      typeof value === "string" &&
      value.length > 0 &&
      value.length <= max &&
      !/[\u0000-\u001f\u007f]/.test(value)
    );
  }

  function validatePublicConfig(value) {
    if (!isPlainRecord(value) || !exactKeys(value, CONFIG_KEYS) || value.schemaVersion !== 1) {
      throw new Error("CONFIG_INVALID");
    }
    if (
      !validConfigString(value.googleClientId, 256) ||
      (value.googleClientId !== PLACEHOLDER_CLIENT_ID && !CLIENT_ID_PATTERN.test(value.googleClientId))
    ) {
      throw new Error("CONFIG_INVALID");
    }
    if (
      !Array.isArray(value.accountAliases) ||
      value.accountAliases.length === 0 ||
      value.accountAliases.length > 8 ||
      value.accountAliases.some((alias) => !validAlias(alias)) ||
      new Set(value.accountAliases).size !== value.accountAliases.length
    ) {
      throw new Error("CONFIG_INVALID");
    }
    if (!isPlainRecord(value.roomCalendars)) throw new Error("CONFIG_INVALID");
    const roomEntries = Object.entries(value.roomCalendars);
    if (
      roomEntries.length === 0 ||
      roomEntries.length > 16 ||
      roomEntries.some(
        ([alias, calendarId]) => !validAlias(alias) || !validConfigString(calendarId, 512),
      )
    ) {
      throw new Error("CONFIG_INVALID");
    }
    return Object.freeze({
      schemaVersion: 1,
      googleClientId: value.googleClientId,
      accountAliases: Object.freeze([...value.accountAliases]),
      roomCalendars: Object.freeze(Object.fromEntries(roomEntries)),
      roomAliases: Object.freeze(roomEntries.map(([alias]) => alias)),
      placeholder:
        value.googleClientId === PLACEHOLDER_CLIENT_ID ||
        roomEntries.some(([, calendarId]) => calendarId.startsWith("replace-with-")),
    });
  }

  function setStatus(message, tone = "idle") {
    elements.status.textContent = message;
    if (elements.error.hidden) elements.statusPanel.dataset.tone = tone;
  }

  function clearError() {
    elements.error.textContent = "";
    elements.error.hidden = true;
    elements.status.hidden = false;
    elements.statusPanel.dataset.tone = "idle";
  }

  function setError(cause, nextAction) {
    elements.error.textContent = `${cause} ${nextAction}`;
    elements.error.hidden = false;
    elements.status.hidden = true;
    elements.statusPanel.dataset.tone = "error";
  }

  function setDisabled(control, reasonElement, disabled, reason, availableReason) {
    control.disabled = disabled;
    reasonElement.textContent = disabled ? reason : availableReason;
  }

  function setButtonLoading(button, loading, normalLabel, loadingLabel) {
    button.setAttribute("aria-busy", String(loading));
    button.textContent = loading ? loadingLabel : normalLabel;
  }

  function hasActiveToken() {
    if (accessToken === null) return false;
    if (Date.now() < accessTokenExpiresAt) return true;
    accessToken = null;
    accessTokenExpiresAt = 0;
    tokenClient = null;
    hasConnected = true;
    return false;
  }

  function authUnavailableReason() {
    if (configState === "loading") return "공개 설정을 확인하고 있어요.";
    if (configState === "error") {
      return "공개 설정을 읽지 못해 Google 연결을 시작할 수 없어요.";
    }
    if (publicConfig?.placeholder) {
      return "config.local 파일을 채우면 Google 연결을 사용할 수 있어요.";
    }
    if (gisState === "loading") return "Google 연결 도구를 불러오고 있어요.";
    if (gisState === "error") return "Google 연결 도구를 불러오지 못했어요. 네트워크를 확인해 주세요.";
    return null;
  }

  function syncControls() {
    const tokenReady = hasActiveToken();
    const unavailableReason = authUnavailableReason();

    setDisabled(
      elements.connect,
      elements.connectReason,
      unavailableReason !== null || tokenReady || authBusy,
      unavailableReason ?? (tokenReady ? "이미 Google 계정이 연결되어 있어요." : "Google 연결을 처리하고 있어요."),
      "Google 연결은 이 버튼을 눌렀을 때만 시작해요.",
    );
    setDisabled(
      elements.reconnect,
      elements.reconnectReason,
      unavailableReason !== null || (!hasConnected && !tokenReady) || authBusy,
      unavailableReason ??
        (!hasConnected && !tokenReady
          ? "먼저 Google 계정을 연결해 주세요."
          : "Google 연결을 처리하고 있어요."),
      "다른 계정을 고르려면 이 버튼을 눌러 주세요.",
    );
    setDisabled(
      elements.revoke,
      elements.revokeReason,
      unavailableReason !== null || !tokenReady || authBusy,
      unavailableReason ?? (!tokenReady ? "해제할 Google 연결이 없어요." : "Google 연결을 처리하고 있어요."),
      "이 버튼은 Google 연결 권한만 해제해요.",
    );

    const selfTestUnavailable = configState !== "ready";
    setDisabled(
      elements.runProbe,
      elements.runReason,
      selfTestUnavailable || probeBusy,
      selfTestUnavailable ? "공개 설정을 먼저 확인해야 해요." : "검사를 실행하고 있어요.",
      "Google에 요청하지 않고 로컬 형식만 확인해요.",
    );
    setDisabled(
      elements.exportEvidence,
      elements.exportReason,
      acceptedEvidence.length === 0 || probeBusy,
      acceptedEvidence.length === 0 ? "내보낼 검사 결과가 없어요." : "검사를 마친 뒤 내보낼 수 있어요.",
      "가려진 검사 결과만 파일로 내려받아요.",
    );
    setDisabled(
      elements.teardown,
      elements.teardownReason,
      !tokenReady && !authBusy && acceptedEvidence.length === 0 && activeRequests.size === 0,
      "정리할 검사 데이터가 없어요.",
      "연결 권한과 메모리의 검사 결과를 함께 정리해요.",
    );
  }

  function renderAliases(list, aliases) {
    list.replaceChildren(
      ...aliases.map((alias) => {
        const item = document.createElement("li");
        item.textContent = alias;
        return item;
      }),
    );
  }

  function initializeTokenClient() {
    if (tokenClient !== null) return tokenClient;
    const oauth = globalThis.google?.accounts?.oauth2;
    if (oauth === undefined || publicConfig === null || publicConfig.placeholder) {
      throw new Error("GOOGLE_CONNECT_UNAVAILABLE");
    }
    const initializedAtRevision = lifecycleRevision;
    tokenClient = oauth.initTokenClient({
      client_id: publicConfig.googleClientId,
      scope: GOOGLE_SCOPES.join(" "),
      include_granted_scopes: true,
      callback: (response) => {
        if (initializedAtRevision !== lifecycleRevision) return;
        authBusy = false;
        setButtonLoading(elements.connect, false, "Google 계정 연결하기", "연결 창 여는 중…");
        setButtonLoading(
          elements.reconnect,
          false,
          "Google 계정 다시 연결하기",
          "연결 창 여는 중…",
        );
        if (
          !isPlainRecord(response) ||
          typeof response.access_token !== "string" ||
          response.access_token.length === 0 ||
          !Number.isFinite(Number(response.expires_in)) ||
          Number(response.expires_in) <= 0 ||
          typeof response.error === "string"
        ) {
          accessToken = null;
          accessTokenExpiresAt = 0;
          hasConnected = true;
          setError(
            "Google 연결이 끝나지 않았어요.",
            "팝업을 허용한 뒤 Google 계정 다시 연결하기를 눌러 주세요.",
          );
          setStatus("Google 연결을 다시 확인해야 해요.");
          syncControls();
          return;
        }
        accessToken = response.access_token;
        const lifetimeMs = Number(response.expires_in) * 1_000;
        accessTokenExpiresAt = Date.now() + Math.max(0, lifetimeMs - 30_000);
        hasConnected = true;
        clearError();
        setStatus("Google 계정이 연결됐어요. 검사는 버튼을 눌렀을 때만 시작해요.", "ready");
        syncControls();
      },
      error_callback: () => {
        if (initializedAtRevision !== lifecycleRevision) return;
        authBusy = false;
        accessToken = null;
        accessTokenExpiresAt = 0;
        hasConnected = true;
        setButtonLoading(elements.connect, false, "Google 계정 연결하기", "연결 창 여는 중…");
        setButtonLoading(
          elements.reconnect,
          false,
          "Google 계정 다시 연결하기",
          "연결 창 여는 중…",
        );
        setError(
          "Google 연결 창을 열지 못했어요.",
          "팝업 설정을 확인한 뒤 Google 계정 다시 연결하기를 눌러 주세요.",
        );
        setStatus("Google 연결을 다시 확인해야 해요.");
        syncControls();
      },
    });
    return tokenClient;
  }

  function requestGoogleConnection(mode) {
    clearError();
    if (authUnavailableReason() !== null) {
      setError("Google 연결을 시작할 준비가 안 됐어요.", "화면에 표시된 설정 사유를 먼저 확인해 주세요.");
      return;
    }
    try {
      const client = initializeTokenClient();
      authBusy = true;
      const button = mode === "connect" ? elements.connect : elements.reconnect;
      setButtonLoading(
        button,
        true,
        mode === "connect" ? "Google 계정 연결하기" : "Google 계정 다시 연결하기",
        "연결 창 여는 중…",
      );
      setStatus("Google 연결 창에서 사용할 계정을 골라 주세요.");
      syncControls();
      client.requestAccessToken({ prompt: mode === "connect" ? "consent" : "select_account" });
    } catch (_error) {
      authBusy = false;
      setButtonLoading(elements.connect, false, "Google 계정 연결하기", "연결 창 여는 중…");
      setButtonLoading(
        elements.reconnect,
        false,
        "Google 계정 다시 연결하기",
        "연결 창 여는 중…",
      );
      setError(
        "Google 연결을 시작하지 못했어요.",
        "네트워크를 확인한 뒤 Google 계정 다시 연결하기를 눌러 주세요.",
      );
      syncControls();
    }
  }

  function createRequestController() {
    const controller = new AbortController();
    activeRequests.add(controller);
    syncControls();
    return controller;
  }

  function releaseRequestController(controller) {
    activeRequests.delete(controller);
    syncControls();
  }

  function clearGoogleState() {
    accessToken = null;
    accessTokenExpiresAt = 0;
    tokenClient = null;
    authBusy = false;
    hasConnected = true;
    setButtonLoading(elements.connect, false, "Google 계정 연결하기", "연결 창 여는 중…");
    setButtonLoading(
      elements.reconnect,
      false,
      "Google 계정 다시 연결하기",
      "연결 창 여는 중…",
    );
  }

  async function revokeGoogleAccess({ clearResults }) {
    clearError();
    const token = hasActiveToken() ? accessToken : null;
    lifecycleRevision += 1;
    const revision = lifecycleRevision;
    clearGoogleState();
    if (clearResults) acceptedEvidence.splice(0);
    syncControls();

    if (token === null) {
      setStatus(clearResults ? "검사 데이터를 정리했어요." : "해제할 Google 연결이 없어요.", "ready");
      return true;
    }

    const controller = createRequestController();
    try {
      await googleFetch.request({
        operation: "oauth-revoke",
        accessToken: token,
        signal: controller.signal,
      });
      if (revision !== lifecycleRevision) return false;
      setStatus(
        clearResults
          ? "Google 연결 권한과 검사 데이터를 정리했어요."
          : "Google 연결 권한을 해제했어요. 검사 결과는 메모리에 남아 있어요.",
        "ready",
      );
      return true;
    } catch (error) {
      if (revision !== lifecycleRevision || error?.name === "AbortError") return false;
      setError(
        clearResults
          ? "브라우저의 검사 데이터는 지웠지만 Google 권한 해제 요청을 확인하지 못했어요."
          : "브라우저의 연결 정보는 지웠지만 Google 권한 해제 요청을 확인하지 못했어요.",
        "다시 연결한 뒤 연결 권한 해제하기를 눌러 주세요.",
      );
      setStatus("Google 권한 해제 결과를 다시 확인해야 해요.");
      return false;
    } finally {
      releaseRequestController(controller);
    }
  }

  function createSafeEvidence() {
    runCounter += 1;
    return Object.freeze({
      schemaVersion: 1,
      probeId: "safe-self-test",
      runId: `safe-self-test-${runCounter}`,
      candidateSha: SAFE_CANDIDATE_SHA,
      observedAt: new Date().toISOString(),
      roleAlias: publicConfig.accountAliases[0],
      browserAlias: "browser-local",
      deviceAlias: "local-device",
      aliases: Object.freeze({ account: publicConfig.accountAliases[0] }),
      operationId: `safe-self-test-${runCounter}`,
      endpoint: SAFE_ENDPOINT,
      capability: "NOT_APPLICABLE",
      result: "SUCCESS",
      teardownStatus: "NOT_REQUIRED",
      notes: Object.freeze(["FIXTURE"]),
    });
  }

  async function runSelectedProbe() {
    clearError();
    if (publicConfig === null || elements.probeSelect.value !== "safe-self-test") {
      setError("선택한 검사를 실행할 수 없어요.", "안전한 자체 검사를 고른 뒤 다시 눌러 주세요.");
      return;
    }

    const revision = lifecycleRevision;
    const controller = createRequestController();
    const evidence = createSafeEvidence();
    probeBusy = true;
    setButtonLoading(
      elements.runProbe,
      true,
      "선택한 검사 실행하기",
      "안전한 자체 검사 실행 중…",
    );
    setStatus("가려진 검사 결과 형식을 확인하고 있어요.");
    syncControls();

    try {
      const response = await fetch("/evidence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(evidence),
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
      if (revision !== lifecycleRevision) return;
      if (response.status !== 204) {
        throw new Error("EVIDENCE_REJECTED");
      }
      acceptedEvidence.push(evidence);
      setStatus("안전한 자체 검사를 마쳤어요. 가려진 결과 1건을 확인했어요.", "ready");
    } catch (error) {
      if (revision !== lifecycleRevision || error?.name === "AbortError") return;
      setError(
        "로컬 서버가 검사 결과를 받지 못했어요.",
        "서버가 실행 중인지 확인한 뒤 선택한 검사 실행하기를 다시 눌러 주세요.",
      );
      setStatus("안전한 자체 검사를 다시 실행해야 해요.");
    } finally {
      releaseRequestController(controller);
      if (revision === lifecycleRevision) {
        probeBusy = false;
        setButtonLoading(
          elements.runProbe,
          false,
          "선택한 검사 실행하기",
          "안전한 자체 검사 실행 중…",
        );
        syncControls();
      }
    }
  }

  function exportAcceptedEvidence() {
    clearError();
    if (acceptedEvidence.length === 0) {
      setError("내보낼 검사 결과가 없어요.", "안전한 자체 검사를 먼저 실행해 주세요.");
      return;
    }
    const payload = acceptedEvidence.length === 1 ? acceptedEvidence[0] : [...acceptedEvidence];
    const objectUrl = URL.createObjectURL(
      new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = "molroom-google-spike-redacted-evidence.json";
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
    setStatus(
      "가려진 검사 결과를 내보냈어요. 내려받은 파일은 확인이 끝나면 직접 삭제해 주세요.",
      "ready",
    );
  }

  async function teardownProbe() {
    clearError();
    lifecycleRevision += 1;
    for (const controller of activeRequests) controller.abort();
    activeRequests.clear();
    probeBusy = false;
    setButtonLoading(
      elements.runProbe,
      false,
      "선택한 검사 실행하기",
      "안전한 자체 검사 실행 중…",
    );
    await revokeGoogleAccess({ clearResults: true });
    syncControls();
  }

  async function loadConfig() {
    try {
      const response = await fetch("/config", {
        method: "GET",
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
      });
      if (!response.ok) throw new Error("CONFIG_UNAVAILABLE");
      publicConfig = validatePublicConfig(await response.json());
      configState = "ready";
      renderAliases(elements.accountAliases, publicConfig.accountAliases);
      renderAliases(elements.roomAliases, publicConfig.roomAliases);
      clearError();
      setStatus(
        publicConfig.placeholder
          ? "예시 설정을 확인했어요. 안전한 자체 검사는 바로 실행할 수 있어요."
          : "공개 설정을 확인했어요. 원하는 작업의 버튼을 눌러 주세요.",
        "ready",
      );
    } catch (_error) {
      publicConfig = null;
      configState = "error";
      renderAliases(elements.accountAliases, ["설정 확인 필요"]);
      renderAliases(elements.roomAliases, ["설정 확인 필요"]);
      setError(
        "공개 검사 설정을 읽지 못했어요.",
        "scripts/google-spike/config.local 파일을 확인한 뒤 페이지를 다시 열어 주세요.",
      );
      setStatus("검사 설정을 다시 확인해야 해요.");
    } finally {
      syncControls();
    }
  }

  function loadGoogleIdentityScript() {
    if (gisState === "ready") {
      syncControls();
      return;
    }
    const script = document.createElement("script");
    script.id = "google-identity-script";
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.referrerPolicy = "no-referrer";
    script.addEventListener("load", () => {
      gisState = globalThis.google?.accounts?.oauth2 ? "ready" : "error";
      syncControls();
    });
    script.addEventListener("error", () => {
      gisState = "error";
      syncControls();
    });
    document.head.append(script);
  }

  elements.connect.addEventListener("click", () => requestGoogleConnection("connect"));
  elements.reconnect.addEventListener("click", () => requestGoogleConnection("reconnect"));
  elements.revoke.addEventListener("click", () => void revokeGoogleAccess({ clearResults: false }));
  elements.runProbe.addEventListener("click", () => void runSelectedProbe());
  elements.exportEvidence.addEventListener("click", exportAcceptedEvidence);
  elements.teardown.addEventListener("click", () => void teardownProbe());

  loadGoogleIdentityScript();
  void loadConfig();
})();
