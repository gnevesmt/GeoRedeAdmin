import { createClient } from "npm:@supabase/supabase-js@2.116.0";

const url = Deno.env.get("SUPABASE_URL") ?? "";
function serverKey(): string {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) {
    try {
      const keys = JSON.parse(raw);
      if (typeof keys?.default === "string" && keys.default) return keys.default;
    } catch {}
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}
const admin = createClient(url, serverKey(), {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});
const allowedOrigins = new Set((Deno.env.get("GEOREDE_ADMIN_ALLOWED_ORIGINS") || "https://gnevesmt.github.io").split(",").map(x=>x.trim()));
allowedOrigins.add('https://gneves-control.pages.dev');
allowedOrigins.add('https://painel.gnevesmt.com.br');
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});
const denied = () => reply({ message: "Login ou senha inválidos, ou acesso bloqueado." }, 401);

async function handle(req: Request) {
  if (req.method !== "POST") return reply({ message: "Método não permitido." }, 405);
  let body: { login?: unknown; password?: unknown };
  try { body = await req.json(); }
  catch { return reply({ message: "Informe Login e Senha." }, 400); }
  const login = String(body.login ?? "").trim().toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";
  if (!/^[a-z0-9._-]{3,60}$/.test(login) || password.length < 8 ||
      password.length > 512) return denied();

  // The RPC is restricted to service_role and enforces its own account lockout.
  const { data: userId, error: checkError } = await admin.rpc(
    "georede_access_verify_password",
    { p_login: login, p_password: password }
  );
  if (checkError) {
    console.error("Mobile credential verifier unavailable:", checkError.code);
    return reply({ message: "Autenticação indisponível no momento." }, 503);
  }
  if (!userId || typeof userId !== "string") return denied();

  const [identity, profile] = await Promise.all([
    admin.auth.admin.getUserById(userId),
    admin.from("profiles").select("id,username,full_name,active")
      .eq("id", userId).maybeSingle()
  ]);
  if (identity.error || profile.error || !identity.data?.user?.email ||
      !profile.data?.active || profile.data.username !== login) return denied();

  // Supabase Auth stores a real email identity for existing users. Keep that
  // identity on the server: sign in with the submitted password, without
  // generating an email link or sending the address to the Mobile client.
  const authClient = createClient(url, serverKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  const { data: verified, error: verifyError } = await authClient.auth.signInWithPassword({
    email: identity.data.user.email, password
  });
  if (verifyError || !verified.session || verified.user?.id !== userId) {
    console.error("Mobile password session failed:", verifyError?.status ?? "no-session");
    return reply({ message: "Não foi possível iniciar a sessão." }, 503);
  }
  return reply({
    access_token: verified.session.access_token,
    refresh_token: verified.session.refresh_token,
    expires_at: verified.session.expires_at,
    expires_in: verified.session.expires_in,
    user: { id: userId, username: login,
      full_name: profile.data.full_name || login }
  });

}
Deno.serve(async(req: Request)=>{
 const origin=req.headers.get('origin')||'';
 if(origin&&!allowedOrigins.has(origin))return reply({message:'Origem não autorizada.'},403);
 const response=req.method==='OPTIONS'?new Response(null,{status:204}):await handle(req);
 if(origin){response.headers.set('Access-Control-Allow-Origin',origin);response.headers.set('Vary','Origin');}
 response.headers.set('Access-Control-Allow-Headers','content-type,apikey,authorization');
 response.headers.set('Access-Control-Allow-Methods','POST,OPTIONS');
 return response;
});
