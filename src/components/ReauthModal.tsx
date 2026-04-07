import type { FormEvent } from "react";

type ReauthModalProps = {
  accountAddress: string;
  password: string;
  isSubmitting: boolean;
  onChangePassword: (value: string) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function ReauthModal({
  accountAddress,
  password,
  isSubmitting,
  onChangePassword,
  onCancel,
  onSubmit
}: ReauthModalProps) {
  return (
    <div className="modal-overlay">
      <form className="modal-card reauth-card" onSubmit={onSubmit}>
        <div className="reauth-copy">
          <span className="eyebrow">Re-authentication</span>
          <h2>Re-enter password for {accountAddress}</h2>
          <p>This account cannot sync again until its password is stored under the current DejAzmach vault key.</p>
        </div>

        <label className="field field-full">
          <span>Password</span>
          <input
            autoFocus
            onChange={(event) => onChangePassword(event.target.value)}
            placeholder="App password or mailbox password"
            type="password"
            value={password}
          />
        </label>

        <div className="reauth-actions">
          <button className="secondary-button" onClick={onCancel} type="button">
            Cancel
          </button>
          <button className="primary-button" disabled={!password.trim() || isSubmitting} type="submit">
            {isSubmitting ? "Confirming..." : "Confirm"}
          </button>
        </div>
      </form>
    </div>
  );
}
