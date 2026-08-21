export type Difficulty = "relaxed" | "clever" | "fierce";
export type Owner = 0 | 1 | 2;
export type PlayedWord = { word: string; owner: 1 | 2; captures?: number };
export type GameMode = "classic" | "daily";

export type SavedGame = {
  gameId: string;
  boardVersion: "circular-31-v1";
  difficulty: Difficulty;
  letters: string[];
  owners: Owner[];
  played: PlayedWord[];
  turn: "you" | "rival" | "done";
  message: string;
  result: "win" | "loss" | "tie" | null;
  mode?: GameMode;
  dailyDate?: string | null;
};

export type AccountUser = { email: string; marketingOptIn: boolean };
export type AccountStats = {
  completed: number;
  wins: number;
  losses: number;
  ties: number;
  streak: number;
  longestWord: string;
  bestMargin: number;
  byDifficulty: Record<Difficulty, { completed: number; wins: number }>;
};
export type DailyStanding = { rank: number; total: number; percentile: number };

export const EMPTY_STATS: AccountStats = {
  completed: 0,
  wins: 0,
  losses: 0,
  ties: 0,
  streak: 0,
  longestWord: "",
  bestMargin: 0,
  byDifficulty: {
    relaxed: { completed: 0, wins: 0 },
    clever: { completed: 0, wins: 0 },
    fierce: { completed: 0, wins: 0 },
  },
};

type ApiResponse<T> = T & { error?: string };

async function request<T>(action: string, init?: RequestInit) {
  const response = await fetch(`/api/index.php?action=${encodeURIComponent(action)}`, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const data = await response.json() as ApiResponse<T>;
  if (!response.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

export function getAccountStatus() {
  return request<{ game: SavedGame | null; stats: AccountStats; user: AccountUser | null }>("status");
}

export function requestLoginCode(email: string) {
  return request<{ ok: true }>("request-code", { body: JSON.stringify({ email }), method: "POST" });
}

export function verifyLoginCode(email: string, code: string) {
  return request<{ game: SavedGame | null; stats: AccountStats; user: AccountUser }>("verify-code", {
    body: JSON.stringify({ code, email }),
    method: "POST",
  });
}

export function saveGame(game: SavedGame) {
  return request<{ daily: DailyStanding | null; game: SavedGame; stats: AccountStats }>("save-game", {
    body: JSON.stringify(game),
    method: "POST",
  });
}

export function logout() {
  return request<{ ok: true }>("logout", { body: "{}", method: "POST" });
}

export function setMarketingOptIn(optIn: boolean) {
  return request<{ user: AccountUser }>("set-marketing-opt-in", { body: JSON.stringify({ optIn }), method: "POST" });
}
