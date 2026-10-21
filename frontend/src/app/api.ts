// Client de l'API (même serveur que l'interface : les chemins /api/... sont relatifs).
// La session est portée par un cookie HttpOnly posé par le serveur à la connexion.

export type RollerStatus = 'on_site' | 'in_transit' | 'maintenance';
export type MovementKind = 'out' | 'in' | 'maintenance_start' | 'maintenance_end';
export type Role = 'admin' | 'agent';

export interface IAgency {
  id: number;
  code: string;
  city: string;
  /** « GS75 Toussieu », ou le code seul si la ville n'est pas renseignée. */
  name: string;
}

export interface IAgencyAdmin extends IAgency {
  rollers: number;
  users: number;
}

export interface IUser {
  id: number;
  username: string;
  role: Role;
  agency: IAgency | null;
  mustChangePassword: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface IRoller {
  id: number;
  code: string;
  agency: IAgency;
  label: string;
  notes: string;
  status: RollerStatus;
  maintenanceReasons: string[];
  maintenanceSince: string | null;
  lastMovementAt: string | null;
  lastAgent: string | null;
  sinceSeconds: number | null;
  overdue: boolean;
  createdAt: string;
  createdBy: string | null;
  archived: boolean;
}

export interface IMovement {
  id: number;
  code: string;
  label: string;
  agency: IAgency;
  kind: MovementKind;
  reasons: string[];
  agent: string | null;
  scannedAt: string;
  cancelled: boolean;
  cancelledAt: string | null;
  cancelledBy: string | null;
}

export interface IRollerDetail extends IRoller {
  movements: IMovement[];
}

export interface IStats {
  total: number;
  onSite: number;
  inTransit: number;
  maintenance: number;
  overdue: number;
  outToday: number;
  inToday: number;
  overdueDays: number;
}

export interface IAgencyStats extends Omit<IStats, 'overdueDays'> {
  agency: IAgency;
}

export interface IOverview {
  totals: IStats;
  agencies: IAgencyStats[];
}

export interface IMaintenanceReason {
  id: string;
  label: string;
}

export interface IServerInfo {
  codePrefix: string;
  codeDigits: number;
  overdueDays: number;
  maintenanceReasons: IMaintenanceReason[];
}

export interface IScanResult {
  result: 'out' | 'in' | 'duplicate' | 'confirm';
  message?: string;
  /** `confirm` : dernier départ ou retour du roller (moins de 24 h), rien n'a été enregistré. */
  lastScan?: { kind: 'out' | 'in'; at: string };
  /** `confirm` : mouvement qui sera enregistré si l'agent confirme. */
  next?: 'out' | 'in';
  /** Date et heure du départ (pour un retour : celle du départ précédent). */
  departedAt?: string | null;
  movement?: IMovement;
  roller: IRoller;
}

export interface IMovementResult {
  movement: IMovement;
  roller: IRoller;
}

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly roller?: IRoller;

  constructor(status: number, code: string, message: string, roller?: IRoller) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.roller = roller;
  }
}

export interface IApiClientOptions {
  /** Appelé quand la session a expiré (ou a été fermée par un administrateur) : retour à l'écran de connexion. */
  onSessionLost: () => void;
}

/** Filtre « agence » d'un administrateur (`null` = toutes les agences). Ignoré pour un compte d'agence. */
type AgencyFilter = number | null | undefined;

function query(params: Record<string, string | number | boolean | null | undefined>): string {
  const qs = new URLSearchParams();
  for (const key of Object.keys(params)) {
    const value = params[key];
    if (value !== undefined && value !== null && value !== '' && value !== false) qs.set(key, String(value));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export class ApiClient {
  constructor(private readonly options: IApiClientOptions) {}

  private async raw(method: string, path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { Accept: 'application/json', 'X-Requested-With': 'mewa-rollers' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res: Response;
    try {
      res = await fetch(path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'same-origin',
      });
    } catch {
      throw new ApiError(0, 'network', 'Serveur injoignable. Vérifiez la connexion réseau puis réessayez.');
    }
    if (res.ok) return res;

    let payload: { error?: string; message?: string; roller?: IRoller } = {};
    try {
      payload = await res.json();
    } catch {
      /* réponse non JSON */
    }
    const error = payload.error ?? 'http_error';
    if (error === 'auth_required' || error === 'password_change_required') this.options.onSessionLost();
    const message =
      payload.message ??
      (res.status === 429 ? 'Trop de tentatives. Patientez quelques minutes.' : `Erreur serveur (${res.status}).`);
    throw new ApiError(res.status, error, message, payload.roller);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.raw(method, path, body);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  // ---------- Connexion ----------

  /** Utilisateur connecté, ou `null` sans session valide. */
  public async me(): Promise<IUser | null> {
    return (await this.request<{ user: IUser | null }>('GET', '/api/auth/me')).user;
  }

  public async login(username: string, password: string): Promise<IUser> {
    return (await this.request<{ user: IUser }>('POST', '/api/auth/login', { username, password })).user;
  }

  public async logout(): Promise<void> {
    await this.request('POST', '/api/auth/logout');
  }

  public async changePassword(currentPassword: string, newPassword: string): Promise<IUser> {
    return (await this.request<{ user: IUser }>('POST', '/api/auth/password', { currentPassword, newPassword })).user;
  }

  // ---------- Rollers et mouvements ----------

  public stats(agency?: AgencyFilter): Promise<IStats> {
    return this.request('GET', `/api/stats${query({ agency })}`);
  }

  /** Format des codes-barres, délai de retard et raisons de maintenance. */
  public info(): Promise<IServerInfo> {
    return this.request('GET', '/api/info');
  }

  public rollers(params: { status?: string; q?: string; includeArchived?: boolean; agency?: AgencyFilter } = {}): Promise<IRoller[]> {
    return this.request('GET', `/api/rollers${query(params)}`);
  }

  public roller(code: string): Promise<IRollerDetail> {
    return this.request('GET', `/api/rollers/${encodeURIComponent(code)}`);
  }

  public createRollers(input: { count: number; label?: string; notes?: string; agencyId?: number }): Promise<IRoller[]> {
    return this.request('POST', '/api/rollers', input);
  }

  public updateRoller(
    code: string,
    input: { label?: string; notes?: string; archived?: boolean; agencyId?: number },
  ): Promise<IRoller> {
    return this.request('PATCH', `/api/rollers/${encodeURIComponent(code)}`, input);
  }

  /** Mise en maintenance (ou changement des raisons d'une maintenance en cours). */
  public startMaintenance(code: string, reasons: string[]): Promise<IMovementResult> {
    return this.request('POST', `/api/rollers/${encodeURIComponent(code)}/maintenance`, { reasons });
  }

  public endMaintenance(code: string): Promise<IMovementResult> {
    return this.request('DELETE', `/api/rollers/${encodeURIComponent(code)}/maintenance`);
  }

  /** `confirm` : l'agent a confirmé un rescan rapproché. */
  public scan(code: string, confirm = false): Promise<IScanResult> {
    return this.request('POST', '/api/scans', confirm ? { code, confirm } : { code });
  }

  public cancelMovement(id: number): Promise<IMovementResult> {
    return this.request('POST', `/api/movements/${id}/cancel`);
  }

  public movements(
    params: { code?: string; limit?: number; before?: number; from?: string; agency?: AgencyFilter } = {},
  ): Promise<IMovement[]> {
    return this.request('GET', `/api/movements${query(params)}`);
  }

  public async exportMovementsCsv(from?: string, agency?: AgencyFilter): Promise<Blob> {
    const res = await this.raw('GET', `/api/export/movements.csv${query({ from, agency })}`);
    return res.blob();
  }

  // ---------- Administration ----------

  public overview(): Promise<IOverview> {
    return this.request('GET', '/api/admin/overview');
  }

  public agencies(): Promise<IAgencyAdmin[]> {
    return this.request('GET', '/api/admin/agencies');
  }

  public createAgency(input: { code: string; city: string }): Promise<IAgency> {
    return this.request('POST', '/api/admin/agencies', input);
  }

  public updateAgency(id: number, input: { code?: string; city?: string }): Promise<IAgency> {
    return this.request('PATCH', `/api/admin/agencies/${id}`, input);
  }

  public deleteAgency(id: number): Promise<void> {
    return this.request('DELETE', `/api/admin/agencies/${id}`);
  }

  public users(): Promise<IUser[]> {
    return this.request('GET', '/api/admin/users');
  }

  public createUser(input: { username: string; password: string; role: Role; agencyId?: number | null }): Promise<IUser> {
    return this.request('POST', '/api/admin/users', input);
  }

  public updateUser(id: number, input: { password?: string; role?: Role; agencyId?: number | null }): Promise<IUser> {
    return this.request('PATCH', `/api/admin/users/${id}`, input);
  }

  public deleteUser(id: number): Promise<void> {
    return this.request('DELETE', `/api/admin/users/${id}`);
  }
}
