import { type FormEvent, useState } from "react";
import {
  requestLoginCode,
  verifyLoginCode,
  type AccountStats,
  type AccountUser,
  type SavedGame,
} from "./api-client";

type Props = {
  account: AccountUser | null;
  stats: AccountStats;
  onClose: () => void;
  onLogin: (result: { game: SavedGame | null; stats: AccountStats; user: AccountUser }) => void;
  onLogout: () => Promise<void>;
  onSetMarketingOptIn: (optIn: boolean) => Promise<void>;
};

export function AccountModal({ account, stats, onClose, onLogin, onLogout, onSetMarketingOptIn }: Props) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [optInBusy, setOptInBusy] = useState(false);

  const toggleOptIn = async (checked: boolean) => {
    setOptInBusy(true);
    setError("");
    try {
      await onSetMarketingOptIn(checked);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong");
    } finally {
      setOptInBusy(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (!codeSent) {
        await requestLoginCode(email);
        setCodeSent(true);
      } else {
        onLogin(await verifyLoginCode(email, code));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    setError("");
    try {
      await onLogout();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong");
      setBusy(false);
    }
  };

  const winRate = stats.completed ? Math.round((stats.wins / stats.completed) * 100) : 0;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="account-modal" role="dialog" aria-modal="true" aria-labelledby="account-title" onMouseDown={event => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose} type="button" aria-label="Close">×</button>
        {account ? (
          <>
            <p className="eyebrow">Your ENCIRCLE account</p>
            <h2 id="account-title">Progress saved.</h2>
            <p className="account-email">{account.email}</p>
            <div className="account-stats">
              <div><strong>{stats.completed}</strong><span>Games</span></div>
              <div><strong>{stats.wins}</strong><span>Wins</span></div>
              <div><strong>{winRate}%</strong><span>Win rate</span></div>
              <div><strong>{stats.streak}</strong><span>Day streak</span></div>
              <div><strong>{stats.longestWord ? stats.longestWord.toUpperCase() : "—"}</strong><span>Your best word</span></div>
              <div><strong>{stats.bestMargin > 0 ? `+${stats.bestMargin}` : stats.bestMargin}</strong><span>Best margin</span></div>
            </div>
            <div className="rival-records">
              {(["relaxed", "clever", "fierce"] as const).map(level => {
                const record = stats.byDifficulty[level];
                return <div key={level}><span>{level}</span><strong>{record.wins}–{record.completed - record.wins}</strong></div>;
              })}
            </div>
            <label className="account-marketing-opt-in">
              <input
                checked={account.marketingOptIn}
                disabled={optInBusy}
                onChange={event => toggleOptIn(event.target.checked)}
                type="checkbox"
              />
              Email me about new features and updates
            </label>
            {error && <p className="account-error" role="alert">{error}</p>}
            <button className="primary" disabled={busy} onClick={onClose} type="button">Keep playing</button>
            <button className="account-guest" disabled={busy} onClick={signOut} type="button">Log out</button>
          </>
        ) : (
          <>
            <p className="eyebrow">Free ENCIRCLE account</p>
            <h2 id="account-title">{codeSent ? "Check your email." : "Keep your progress."}</h2>
            <p>{codeSent ? `We sent a six-digit code to ${email}. Check your inbox and spam folder.` : "Log in with your email to save games and track your wins across all your devices."}</p>
            <form onSubmit={submit}>
              {!codeSent ? (
                <label>
                  Email address
                  <input autoComplete="email" inputMode="email" onChange={event => setEmail(event.target.value)} required type="email" value={email} />
                </label>
              ) : (
                <label>
                  Six-digit code
                  <input autoComplete="one-time-code" inputMode="numeric" maxLength={6} onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} pattern="[0-9]{6}" required value={code} />
                </label>
              )}
              {error && <p className="account-error" role="alert">{error}</p>}
              <button className="primary" disabled={busy} type="submit">{busy ? "One moment…" : codeSent ? "Log in" : "Send my code"}</button>
            </form>
            {codeSent && <button className="account-back" onClick={() => { setCodeSent(false); setCode(""); setError(""); }} type="button">Use a different email</button>}
            <button className="account-guest" onClick={onClose} type="button">Continue as guest</button>
          </>
        )}
      </section>
    </div>
  );
}
