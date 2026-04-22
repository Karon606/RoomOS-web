// app/(app)/loading.tsx
'use client';

export default function Loading() {
  return (
    // bg-[#f5efe6]/70: 가이드라인의 Canvas 컬러에 투명도 적용
    // backdrop-blur-sm: 뒷배경을 은은하게 흐릿하게 처리
    <div className="relative flex h-full w-full items-center justify-center bg-[#f5efe6]/70 p-4 backdrop-blur-sm">
      <div className="rounded-3xl bg-[#0d0f14]/5 p-12">
        {/* RoomOS Coral(#f4623a) 및 Warm Mid(#7a6a5a) 컬러 적용 */}
        <div className="h-16 w-16 animate-spin rounded-full border-4 border-[#7a6a5a]/20 border-t-[#f4623a]">
        </div>
      </div>
    </div>
  );
}