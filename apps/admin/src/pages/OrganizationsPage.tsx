import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { Organization, User, UserRole, ZernioApiKeyOption } from "@mizaly/shared";
import { apiClient, ApiError } from "../lib/apiClient";

type OrganizationWithUsers = Organization & { users: User[] };

interface CreateUserResponse {
  organization: Organization;
  user: User;
}

// Represents the "no explicit assignment" option in a <select> - real
// zernioApiKeyId values are the key ids themselves (e.g. "1", "2").
const UNASSIGNED_KEY_VALUE = "";

export default function OrganizationsPage() {
  const [organizations, setOrganizations] = useState<OrganizationWithUsers[]>([]);
  const [zernioApiKeys, setZernioApiKeys] = useState<ZernioApiKeyOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [isCreateFormOpen, setIsCreateFormOpen] = useState(false);
  const [organizationName, setOrganizationName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [createZernioApiKeyId, setCreateZernioApiKeyId] = useState(UNASSIGNED_KEY_VALUE);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState<UserRole | string>("owner");
  const [editZernioApiKeyId, setEditZernioApiKeyId] = useState(UNASSIGNED_KEY_VALUE);
  const [editError, setEditError] = useState<string | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const [editingOrgContext, setEditingOrgContext] = useState<OrganizationWithUsers | null>(null);
  const [contextValue, setContextValue] = useState("");
  const [contextError, setContextError] = useState<string | null>(null);
  const [isSavingContext, setIsSavingContext] = useState(false);

  async function loadAll() {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [orgs, keys] = await Promise.all([
        apiClient.get<OrganizationWithUsers[]>("/api/admin/organizations"),
        apiClient.get<{ keys: ZernioApiKeyOption[] }>("/api/admin/zernio-api-keys"),
      ]);
      setOrganizations(orgs);
      setZernioApiKeys(keys.keys);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Nie udało się pobrać danych.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  // Zernio caps each key at 2 accounts - shown next to each option so an
  // admin can see at a glance which keys still have room before assigning.
  const usageByKeyId = useMemo(() => {
    const usage = new Map<string, number>();
    for (const org of organizations) {
      for (const user of org.users) {
        if (user.zernioApiKeyId) {
          usage.set(user.zernioApiKeyId, (usage.get(user.zernioApiKeyId) ?? 0) + 1);
        }
      }
    }
    return usage;
  }, [organizations]);

  function keyOptionLabel(key: ZernioApiKeyOption, excludeUserId?: string): string {
    let count = usageByKeyId.get(key.id) ?? 0;
    if (excludeUserId && editingUser?.zernioApiKeyId === key.id) {
      count = Math.max(0, count - 1);
    }
    return `${key.label} (${count}/2 zajęte)`;
  }

  function describeAssignedKey(zernioApiKeyId: string | null): string {
    if (!zernioApiKeyId) return "— (domyślny, klucz 1)";
    const key = zernioApiKeys.find((k) => k.id === zernioApiKeyId);
    return key ? key.label : `Nieznany klucz (${zernioApiKeyId})`;
  }

  function resetCreateForm() {
    setOrganizationName("");
    setEmail("");
    setPassword("");
    setCreateZernioApiKeyId(UNASSIGNED_KEY_VALUE);
    setCreateError(null);
  }

  function openCreateForm() {
    resetCreateForm();
    setSuccessMessage(null);
    setIsCreateFormOpen(true);
  }

  function closeCreateForm() {
    setIsCreateFormOpen(false);
    resetCreateForm();
  }

  async function handleCreateSubmit(event: FormEvent) {
    event.preventDefault();
    setCreateError(null);
    setIsCreating(true);
    try {
      await apiClient.post<CreateUserResponse>("/api/admin/users", {
        organizationName,
        email,
        password,
        zernioApiKeyId: createZernioApiKeyId || null,
      });
      setIsCreateFormOpen(false);
      resetCreateForm();
      setSuccessMessage(
        `Konto dla ${email} zostało utworzone. Zapisz i przekaż te dane logowania użytkownikowi — ` +
          "automatyczna wysyłka (Magic Link) pojawi się później."
      );
      await loadAll();
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : "Nie udało się utworzyć użytkownika.");
    } finally {
      setIsCreating(false);
    }
  }

  function openEditForm(user: User) {
    setEditingUser(user);
    setEditEmail(user.email);
    setEditRole(user.role);
    setEditZernioApiKeyId(user.zernioApiKeyId ?? UNASSIGNED_KEY_VALUE);
    setEditError(null);
    setSuccessMessage(null);
  }

  function closeEditForm() {
    setEditingUser(null);
    setEditError(null);
  }

  async function handleEditSubmit(event: FormEvent) {
    event.preventDefault();
    if (!editingUser) return;
    setEditError(null);
    setIsSavingEdit(true);
    try {
      await apiClient.patch(`/api/admin/users/${editingUser.id}`, {
        email: editEmail,
        role: editRole,
        zernioApiKeyId: editZernioApiKeyId || null,
      });
      setEditingUser(null);
      setSuccessMessage(`Dane użytkownika ${editEmail} zostały zapisane.`);
      await loadAll();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : "Nie udało się zapisać zmian.");
    } finally {
      setIsSavingEdit(false);
    }
  }

  function openContextForm(org: OrganizationWithUsers) {
    setEditingOrgContext(org);
    setContextValue(org.aiContext ?? "");
    setContextError(null);
    setSuccessMessage(null);
  }

  function closeContextForm() {
    setEditingOrgContext(null);
    setContextError(null);
  }

  async function handleContextSubmit(event: FormEvent) {
    event.preventDefault();
    if (!editingOrgContext) return;
    setContextError(null);
    setIsSavingContext(true);
    try {
      await apiClient.patch(`/api/admin/organizations/${editingOrgContext.id}`, {
        aiContext: contextValue.trim() || null,
      });
      setEditingOrgContext(null);
      setSuccessMessage(`Kontekst AI dla organizacji ${editingOrgContext.name} został zapisany.`);
      await loadAll();
    } catch (err) {
      setContextError(err instanceof ApiError ? err.message : "Nie udało się zapisać kontekstu.");
    } finally {
      setIsSavingContext(false);
    }
  }

  const rows = organizations.flatMap((org) => org.users.map((user) => ({ org, user })));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Organizacje i użytkownicy</h1>
          <p className="page-subtitle">Lista wszystkich organizacji (tenantów) i ich użytkowników.</p>
        </div>
        <button type="button" onClick={openCreateForm}>
          ➕ Dodaj użytkownika
        </button>
      </div>

      {successMessage && <div className="form-success">{successMessage}</div>}

      {isCreateFormOpen && (
        <div className="modal-backdrop" onClick={closeCreateForm}>
          <form className="modal-card" onClick={(e) => e.stopPropagation()} onSubmit={handleCreateSubmit}>
            <h2>Dodaj użytkownika</h2>

            <label htmlFor="organizationName">Nazwa organizacji</label>
            <input
              id="organizationName"
              value={organizationName}
              onChange={(e) => setOrganizationName(e.target.value)}
              required
              autoFocus
            />

            <label htmlFor="newUserEmail">E-mail</label>
            <input
              id="newUserEmail"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />

            <label htmlFor="newUserPassword">Hasło</label>
            <input
              id="newUserPassword"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />

            <label htmlFor="newUserZernioKey">Zeniro API Key</label>
            <select
              id="newUserZernioKey"
              value={createZernioApiKeyId}
              onChange={(e) => setCreateZernioApiKeyId(e.target.value)}
            >
              <option value={UNASSIGNED_KEY_VALUE}>— (domyślny, klucz 1)</option>
              {zernioApiKeys.map((key) => (
                <option key={key.id} value={key.id}>
                  {keyOptionLabel(key)}
                </option>
              ))}
            </select>

            {createError && <div className="form-error">{createError}</div>}

            <div className="modal-card__actions">
              <button type="button" className="secondary" onClick={closeCreateForm}>
                Anuluj
              </button>
              <button type="submit" disabled={isCreating}>
                {isCreating ? "Zapisywanie…" : "Zapisz"}
              </button>
            </div>
          </form>
        </div>
      )}

      {editingUser && (
        <div className="modal-backdrop" onClick={closeEditForm}>
          <form className="modal-card" onClick={(e) => e.stopPropagation()} onSubmit={handleEditSubmit}>
            <h2>Edytuj użytkownika</h2>

            <label htmlFor="editUserEmail">E-mail</label>
            <input
              id="editUserEmail"
              type="email"
              value={editEmail}
              onChange={(e) => setEditEmail(e.target.value)}
              required
              autoFocus
            />

            <label htmlFor="editUserRole">Rola</label>
            <select id="editUserRole" value={editRole} onChange={(e) => setEditRole(e.target.value)}>
              <option value="owner">owner</option>
              <option value="member">member</option>
            </select>

            <label htmlFor="editUserZernioKey">Zeniro API Key</label>
            <select
              id="editUserZernioKey"
              value={editZernioApiKeyId}
              onChange={(e) => setEditZernioApiKeyId(e.target.value)}
            >
              <option value={UNASSIGNED_KEY_VALUE}>— (domyślny, klucz 1)</option>
              {zernioApiKeys.map((key) => (
                <option key={key.id} value={key.id}>
                  {keyOptionLabel(key, editingUser.id)}
                </option>
              ))}
            </select>

            {editError && <div className="form-error">{editError}</div>}

            <div className="modal-card__actions">
              <button type="button" className="secondary" onClick={closeEditForm}>
                Anuluj
              </button>
              <button type="submit" disabled={isSavingEdit}>
                {isSavingEdit ? "Zapisywanie…" : "Zapisz"}
              </button>
            </div>
          </form>
        </div>
      )}

      {editingOrgContext && (
        <div className="modal-backdrop" onClick={closeContextForm}>
          <form className="modal-card" onClick={(e) => e.stopPropagation()} onSubmit={handleContextSubmit}>
            <h2>Kontekst AI: {editingOrgContext.name}</h2>
            <p className="form-hint">
              Informacje o kliencie, które AI ma traktować jako już znane przy generowaniu postów (np. „trener
              personalny, 10 lat doświadczenia”), żeby nie dopytywał o rzeczy, które już wiadomo.
            </p>

            <label htmlFor="orgAiContext">Kontekst</label>
            <textarea
              id="orgAiContext"
              rows={5}
              value={contextValue}
              onChange={(e) => setContextValue(e.target.value)}
              autoFocus
            />

            {contextError && <div className="form-error">{contextError}</div>}

            <div className="modal-card__actions">
              <button type="button" className="secondary" onClick={closeContextForm}>
                Anuluj
              </button>
              <button type="submit" disabled={isSavingContext}>
                {isSavingContext ? "Zapisywanie…" : "Zapisz"}
              </button>
            </div>
          </form>
        </div>
      )}

      {isLoading && <p>Ładowanie…</p>}
      {loadError && <div className="form-error">{loadError}</div>}

      {!isLoading && !loadError && (
        <table className="data-table">
          <thead>
            <tr>
              <th>Organizacja</th>
              <th>E-mail</th>
              <th>Rola</th>
              <th>Zeniro API Key</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="data-table__empty">
                  Brak organizacji. Dodaj pierwszego użytkownika, aby utworzyć organizację.
                </td>
              </tr>
            )}
            {rows.map(({ org, user }) => (
              <tr key={user.id}>
                <td>
                  {org.name}
                  <div style={{ marginTop: 6 }}>
                    <button type="button" className="secondary" onClick={() => openContextForm(org)}>
                      Kontekst AI
                    </button>
                  </div>
                </td>
                <td>{user.email}</td>
                <td>{user.role}</td>
                <td>{describeAssignedKey(user.zernioApiKeyId)}</td>
                <td>
                  <button type="button" className="secondary" onClick={() => openEditForm(user)}>
                    Edytuj
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
