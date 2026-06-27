"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function Home() {
  const router = useRouter();
  const [formId, setFormId] = useState("");

  const enter = (role: "A" | "B") => {
    const id = formId.trim() || "demo";
    router.push(`/form/${encodeURIComponent(id)}?role=${role}`);
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      <div className="space-y-1 text-center">
        <h1 className="text-2xl font-bold">실시간 동기화 폼</h1>
        <p className="text-sm text-muted-foreground">
          작성자(A)와 상담사(B)가 같은 폼 화면을 실시간으로 공유합니다.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>폼 입장</CardTitle>
          <CardDescription>
            같은 폼 ID로 입장하면 화면이 양방향으로 동기화됩니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="formId">폼 ID</Label>
          <Input
            id="formId"
            value={formId}
            placeholder="demo"
            onChange={(e) => setFormId(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && enter("A")}
          />
          <p className="text-xs text-muted-foreground">
            비워두면 <span className="font-mono">demo</span> 로 입장합니다.
          </p>
        </CardContent>
        <CardFooter className="grid grid-cols-2 gap-2">
          <Button onClick={() => enter("A")}>작성자 A로 입장</Button>
          <Button variant="secondary" onClick={() => enter("B")}>
            상담사 B로 입장
          </Button>
        </CardFooter>
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        두 개의 브라우저 탭에서 각각 A·B로 같은 폼 ID에 입장해 동기화를 확인하세요.
      </p>
    </main>
  );
}
