import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { FiCheck, FiCopy, FiPlus, FiTrash2 } from "react-icons/fi";
import { useApiKeys, useCreateApiKey, useDeleteApiKey } from "../hooks/useVault";

export function ConfigApiKeys() {
  const { t } = useTranslation("config");
  const { data: keys } = useApiKeys();
  const createApiKey = useCreateApiKey();
  const deleteApiKey = useDeleteApiKey();

  const [name, setName] = useState("");
  const [copied, setCopied] = useState(false);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    createApiKey.mutate(name.trim(), { onSuccess: () => setName("") });
  }

  async function copyKey(key: string) {
    await navigator.clipboard.writeText(key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div>
      <header className="config-header">
        <div>
          <h2>{t("tabs.apiKeys")}</h2>
          <p className="muted">{t("apiKeys.subtitle")}</p>
        </div>
      </header>

      <div className="grid" style={{ gap: 24 }}>
        {createApiKey.data && (
          <div className="card">
            <div className="card-intro">
              <h2>{t("apiKeys.created.title", { name: createApiKey.data.name })}</h2>
              <p className="muted">{t("apiKeys.created.subtitle")}</p>
            </div>
            <code className="api-key-value">{createApiKey.data.key}</code>
            <div className="form-actions" style={{ marginTop: 10 }}>
              <button
                type="button"
                className="secondary"
                onClick={() => copyKey(createApiKey.data!.key)}
              >
                {copied ? <FiCheck /> : <FiCopy />}
                {copied ? t("apiKeys.copied") : t("apiKeys.copy")}
              </button>
              <button type="button" className="secondary" onClick={() => createApiKey.reset()}>
                {t("apiKeys.created.done")}
              </button>
            </div>
          </div>
        )}

        <form className="card grid" style={{ gap: 16 }} onSubmit={submit}>
          <div className="card-intro">
            <h2>{t("apiKeys.new.title")}</h2>
            <p className="muted">{t("apiKeys.new.subtitle")}</p>
          </div>
          <div className="form-actions">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("apiKeys.new.namePlaceholder")}
              style={{ flex: 1, minWidth: 200 }}
            />
            <button type="submit" disabled={createApiKey.isPending || !name.trim()}>
              <FiPlus /> {t("apiKeys.new.submit")}
            </button>
          </div>
        </form>

        <div className="card">
          <h2>{t("apiKeys.list.title")}</h2>
          {!keys || keys.length === 0 ? (
            <p className="muted">{t("apiKeys.list.empty")}</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>{t("apiKeys.list.name")}</th>
                  <th>{t("apiKeys.list.createdAt")}</th>
                  <th>{t("apiKeys.list.lastUsedAt")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {keys.map((key) => (
                  <tr key={key.id}>
                    <td>{key.name}</td>
                    <td className="muted">{key.createdAt}</td>
                    <td className="muted">{key.lastUsedAt ?? t("apiKeys.list.neverUsed")}</td>
                    <td style={{ textAlign: "right" }}>
                      <span className="row-actions">
                        <button
                          className="danger icon"
                          title={t("apiKeys.list.revoke")}
                          onClick={() => deleteApiKey.mutate(key.id)}
                        >
                          <FiTrash2 />
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
