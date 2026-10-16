// Client de l'API (même serveur que l'interface : les chemins /api/... sont relatifs).

export type RollerStatus = 'on_site' | 'in_transit';

export interface IRoller {
  id: number;
  code: string;
  label: string;
  notes: string;
  status: RollerStatus;
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
  direction: 'out' | 'in';
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
  overdue: number;
  outToday: number;
  inToday: number;
  overdueDays: number;
}

export interface IServerInfo {
  station: string;
  codePrefix: string;
  codeDigits: number;
}

export interface IScanResult {
  result: 'out' | 'in' | 'duplicate';
  message?: string;
  /** Date et heure du départ (pour un retour : celle du départ précédent). */
  departedAt?: string | null;
  movement?: IMovement;
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
  /** Code d'accès mémorisé sur l'appareil (si le serveur en exige un). */
  getAccessCode: () => string;
  /**
   * Appelé quand le serveur réclame le code d'accès : affiche la saisie et
   * résout `true` quand un nouveau code a été saisi (la requête est alors rejouée).
   */
  requestAccessCode: (invalid: boolean) => Promise<boolean>;
}

const ACCESS_ERRORS = ['access_code_required', 'access_code_invalid'];

export class ApiClient {
  constructor(private readonly options: IApiClientOptions) {}

  private headers(json: boolean): Record<string, string> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (json) headers['Content-Type'] = 'application/json';
    const code = this.options.getAccessCode();
    if (code) headers['X-Access-Code'] = encodeURIComponent(code);
    return headers;
  }

  private async raw(method: string, path: string, body?: unknown): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await fetch(path, {
          method,
          headers: this.headers(body !== undefined),
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
      if (res.status === 401 && ACCESS_ERRORS.includes(error) && attempt < 5) {
        if (await this.options.requestAccessCode(error === 'access_code_invalid')) continue;
      }
      const message =
        payload.message ??
        (res.status === 429 ? 'Trop de tentatives. Patientez quelques minutes.' : `Erreur serveur (${res.status}).`);
      throw new ApiError(res.status, error, message, payload.roller);
    }
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.raw(method, path, body);
    return (await res.json()) as T;
  }

  public stats(): Promise<IStats> {
    return this.request('GET', '/api/stats');
  }

  /** Nom du poste (enregistré avec chaque scan) et format des codes-barres. */
  public info(): Promise<IServerInfo> {
    return this.request('GET', '/api/info');
  }

  public rollers(params: { status?: string; q?: string; includeArchived?: boolean } = {}): Promise<IRoller[]> {
    const qs = new URLSearchParams();
    if (params.status) qs.set('status', params.status);
    if (params.q) qs.set('q', params.q);
    if (params.includeArchived) qs.set('includeArchived', 'true');
    const query = qs.toString();
    return this.request('GET', `/api/rollers${query ? '?' + query : ''}`);
  }

  public roller(code: string): Promise<IRollerDetail> {
    return this.request('GET', `/api/rollers/${encodeURIComponent(code)}`);
  }

  public createRollers(input: { count: number; label?: string; notes?: string }): Promise<IRoller[]> {
    return this.request('POST', '/api/rollers', input);
  }

  public updateRoller(code: string, input: { label?: string; notes?: string; archived?: boolean }): Promise<IRoller> {
    return this.request('PATCH', `/api/rollers/${encodeURIComponent(code)}`, input);
  }

  public scan(code: string): Promise<IScanResult> {
    return this.request('POST', '/api/scans', { code });
  }

  public cancelMovement(id: number): Promise<{ movement: IMovement; roller: IRoller }> {
    return this.request('POST', `/api/movements/${id}/cancel`);
  }

  public movements(params: { code?: string; limit?: number; before?: number; from?: string } = {}): Promise<IMovement[]> {
    const qs = new URLSearchParams();
    if (params.code) qs.set('code', params.code);
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.before) qs.set('before', String(params.before));
    if (params.from) qs.set('from', params.from);
    return this.request('GET', `/api/movements?${qs.toString()}`);
  }

  public async exportMovementsCsv(from?: string): Promise<Blob> {
    const qs = from ? `?from=${encodeURIComponent(from)}` : '';
    const res = await this.raw('GET', `/api/export/movements.csv${qs}`);
    return res.blob();
  }
}
