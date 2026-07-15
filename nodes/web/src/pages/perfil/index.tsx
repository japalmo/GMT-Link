import type { ReactNode } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ErrorState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/page-header';
import { useProfile } from '@/hooks/use-profile';
import { RoleChips } from '@/pages/usuarios/role-chips';
import { PersonAvatar } from '@/pages/directorio/person-avatar';
import { ProfileForm } from './profile-form';
import { ChangePasswordForm } from './change-password-form';
import { ProfileTabs } from './profile-tabs';

/** Skeleton de carga del perfil, con la forma de la cabecera + tarjetas. */
function ProfileSkeleton(): ReactNode {
  return (
    <div className="flex animate-pulse flex-col gap-6" aria-hidden>
      <div className="flex items-center gap-4">
        <div className="size-16 rounded-full bg-muted" />
        <div className="flex flex-col gap-2">
          <div className="h-5 w-48 rounded bg-muted" />
          <div className="h-4 w-32 rounded bg-muted" />
        </div>
      </div>
      <div className="h-72 rounded-lg border border-border bg-muted/40" />
      <div className="h-60 rounded-lg border border-border bg-muted/40" />
    </div>
  );
}

/**
 * Página de Perfil → "Mis datos" (§6-1.3).
 *
 * Compone el hook `useProfile` con la cabecera de identidad (avatar, roles,
 * estado y tipo), el formulario editable de datos y la sección de cambio de
 * contraseña. Estados de carga / error siempre presentes. Mobile-first.
 */
export default function PerfilPage(): ReactNode {
  const {
    profile,
    loading,
    error,
    refetch,
    save,
    changePassword,
    requestPasswordChange,
    requestEmailChange,
    requestEmailVerify,
    confirmEmailChange,
  } = useProfile();

  return (
    <PageContainer maxWidth="3xl">
      <header className="flex flex-col gap-4">
        <PageHeader
          title="Mi perfil"
          description="Revisa y actualiza tu información personal y tu contraseña."
        />
        <ProfileTabs />
      </header>

      {loading && <ProfileSkeleton />}

      {!loading && error && <ErrorState message={error} onRetry={() => void refetch()} />}

      {!loading && !error && profile && (
        <>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <PersonAvatar
              firstName={profile.firstName}
              lastName={profile.lastName}
              avatarUrl={profile.avatarUrl}
              size="lg"
            />
            <div className="flex min-w-0 flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-semibold tracking-tight">
                  {profile.firstName} {profile.lastName}
                </h2>
                <StatusBadge type="user" status={profile.status} />
                <span className="inline-flex items-center whitespace-nowrap rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                  {profile.isClientUser ? 'Cliente' : 'Colaborador'}
                </span>
              </div>
              <p className="truncate text-sm text-muted-foreground">{profile.email}</p>
              <RoleChips roleKeys={profile.roleKeys} />
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Información personal</CardTitle>
              <CardDescription>
                Tus correos, nombre y avatar. Cambiar un correo requiere verificarlo
                con un código.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ProfileForm
                profile={profile}
                onSave={save}
                onRequestEmailChange={requestEmailChange}
                onRequestEmailVerify={requestEmailVerify}
                onConfirmEmailChange={confirmEmailChange}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Cambiar contraseña</CardTitle>
              <CardDescription>
                Define una contraseña nueva para tu cuenta.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ChangePasswordForm
                onChangePassword={changePassword}
                onRequestCode={requestPasswordChange}
              />
            </CardContent>
          </Card>
        </>
      )}
    </PageContainer>
  );
}
