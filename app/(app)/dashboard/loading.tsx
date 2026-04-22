// app/(app)/loading.tsx 
export default function Loading() {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-[#0d0f14]">
      {/* 텍스트 없이 심플한 스피너 아이콘만 노출 */}
      <div className="h-12 w-12 animate-spin rounded-full border-4 border-t-[#4f7fff] border-r-transparent border-b-[#7c5cfc] border-l-transparent">
      </div>
    </div>
  )
}