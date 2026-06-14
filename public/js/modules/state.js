export const state = {
  ws: null,
  lastHash: null,
  agentRunning: false,
  cdpConnected: false,
  isRendering: false,
  isSending: false,
  userScrolledAway: false,
  isMobile: window.matchMedia('(pointer: coarse)').matches,
  overlayDismissedAt: 0,
  lastSidebarSignature: null,
  sidebarFetchInFlight: false,
  activeArtifactUri: null,
  activeFileUri: null,
  pendingCommentSelection: '',
  pendingCommentUri: '',
  queuedComments: JSON.parse(localStorage.getItem('ag2r_queued_comments') || '[]'),
  runningTasksCollapsed: false,
  stagedImages: [], // { file: File, objectUrl: string }
  stopMainMic: null,
  imageProxyCache: new Map(),
  pendingTextInputPlaceholder: null,
  pendingTextInputClickId: null,
  isInSubagentView: false,
  subagentViewTaskName: ''
};

