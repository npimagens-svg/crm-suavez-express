import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Eye, EyeOff } from "lucide-react";
import { z } from "zod";
import { supabase } from "@/lib/dynamicSupabaseClient";

const loginSchema = z.object({
  email: z.string().email("Email inválido"),
  password: z.string().min(6, "Senha deve ter pelo menos 6 caracteres"),
});

export default function AuthNew() {
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loginData, setLoginData] = useState({ email: "", password: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [resetLoading, setResetLoading] = useState(false);

  const { signIn } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const handleResetPassword = async () => {
    const email = loginData.email.trim();
    if (!email) {
      toast({ title: "Digite seu email primeiro", description: "Preencha o campo email acima e clique de novo em 'Esqueci minha senha'.", variant: "destructive" });
      return;
    }
    setResetLoading(true);
    const redirectTo = `${window.location.origin}/auth`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    setResetLoading(false);
    if (error) {
      toast({ title: "Erro ao enviar link", description: error.message, variant: "destructive" });
    } else {
      toast({
        title: "Link enviado!",
        description: `Se o email ${email} estiver cadastrado, você receberá um link para redefinir a senha.`,
      });
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    
    const result = loginSchema.safeParse(loginData);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.errors.forEach((err) => {
        if (err.path[0]) fieldErrors[err.path[0] as string] = err.message;
      });
      setErrors(fieldErrors);
      return;
    }

    setLoading(true);
    const { error } = await signIn(loginData.email, loginData.password);
    setLoading(false);

    if (error) {
      toast({
        title: "Erro ao entrar",
        description: error.message === "Invalid login credentials" 
          ? "Email ou senha incorretos" 
          : error.message,
        variant: "destructive",
      });
    } else {
      navigate("/");
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left side - Branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-primary via-primary/90 to-primary/70 relative overflow-hidden">
        <div className="absolute bottom-0 left-0 right-0">
          <svg viewBox="0 0 1440 320" className="w-full">
            <path
              fill="rgba(255,255,255,0.1)"
              d="M0,192L48,197.3C96,203,192,213,288,229.3C384,245,480,267,576,250.7C672,235,768,181,864,181.3C960,181,1056,235,1152,234.7C1248,235,1344,181,1392,154.7L1440,128L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z"
            />
          </svg>
        </div>
        <div className="absolute bottom-0 left-0 right-0">
          <svg viewBox="0 0 1440 320" className="w-full translate-y-10">
            <path
              fill="rgba(255,255,255,0.05)"
              d="M0,64L48,80C96,96,192,128,288,128C384,128,480,96,576,90.7C672,85,768,107,864,128C960,149,1056,171,1152,165.3C1248,160,1344,128,1392,112L1440,96L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z"
            />
          </svg>
        </div>

        <div className="flex flex-col items-center justify-center w-full p-12 text-white z-10">
          <div className="mb-8">
            <div className="flex items-center gap-1 text-white/90">
              <span className="text-4xl">⌐</span>
              <h1 className="text-5xl font-bold">Bem-vindo.</h1>
              <span className="text-4xl">⌐</span>
            </div>
          </div>
          <p className="text-center text-lg text-white/80 max-w-md">
            Feito para impulsionar negócios de beleza e bem-estar, 
            conectamos tecnologia e conhecimento especializado 
            para cuidar do seu negócio de forma completa.
          </p>
        </div>
      </div>

      {/* Right side - Form */}
      <div className="w-full lg:w-1/2 flex flex-col items-center justify-center p-8 bg-background">
        <div className="w-full max-w-md">
          <div className="flex justify-center mb-8">
            <div className="flex items-center gap-2">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground font-bold text-2xl">
                S
              </div>
              <span className="text-2xl font-bold text-primary">Salão CRM</span>
            </div>
          </div>

          <h2 className="text-2xl font-bold mb-2">Entrar</h2>
          <p className="text-muted-foreground mb-8">
            Digite suas credenciais para acessar o sistema
          </p>

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                placeholder="seu@email.com"
                value={loginData.email}
                onChange={(e) => setLoginData({ ...loginData, email: e.target.value.toLowerCase() })}
                className="h-12"
              />
              {errors.email && <p className="text-sm text-destructive">{errors.email}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Digite sua senha..."
                  value={loginData.password}
                  onChange={(e) => setLoginData({ ...loginData, password: e.target.value })}
                  className="h-12 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
              {errors.password && <p className="text-sm text-destructive">{errors.password}</p>}
            </div>

            <button
              type="button"
              onClick={handleResetPassword}
              disabled={resetLoading}
              className="text-sm text-primary hover:underline disabled:opacity-50"
            >
              {resetLoading ? "Enviando..." : "Esqueci minha senha"}
            </button>

            <Button type="submit" className="w-full h-12 text-base" disabled={loading}>
              {loading ? "Entrando..." : "Acessar conta"}
            </Button>
          </form>

          <div className="mt-8 text-center">
            <p className="text-xs text-muted-foreground">
              © 2026 Salão CRM • Todos os direitos reservados
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}