import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { CampCanvas } from "@/campfire/CampCanvas";
import { createCampfireAudio } from "@/campfire/audio";
import { useViewer } from "@/campfire/store";
import { ViewerChrome } from "@/components/ViewerChrome";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  useEffect(() => {
    let audio: ReturnType<typeof createCampfireAudio> | null = null;
    const start = () => {
      if (!audio) audio = createCampfireAudio();
      audio.resume();
      audio.setMuted(useViewer.getState().muted);
    };
    const unsub = useViewer.subscribe((state) => {
      audio?.setMuted(state.muted);
    });
    window.addEventListener("pointerdown", start, { once: true });
    return () => {
      window.removeEventListener("pointerdown", start);
      unsub();
      audio?.dispose();
    };
  }, []);

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-bg text-fg">
      <CampCanvas />
      <ViewerChrome />
    </main>
  );
}
