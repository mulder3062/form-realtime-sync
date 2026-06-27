import FormView from "@/components/FormView";
import type { Role } from "@/lib/types";

// Next.js 16: params/searchParams 는 Promise (await 필요)
export default async function FormPage({
  params,
  searchParams,
}: {
  params: Promise<{ formId: string }>;
  searchParams: Promise<{ role?: string }>;
}) {
  const { formId } = await params;
  const { role: roleParam } = await searchParams;
  const role: Role = roleParam === "counselor" ? "COUNSELOR" : "AUTHOR";

  return <FormView formId={formId} role={role} />;
}
