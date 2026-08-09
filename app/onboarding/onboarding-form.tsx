"use client";

import { useEffect, useState, type FormEvent } from "react";
import { AccountShell, LoadingPanel, accountStyles as styles } from "../_components/account/account-shell";
import {
  normalizeAccountPayload,
  readAccountResponse,
  type IntentionKey,
} from "../_components/account/account-types";

const intentions: Array<{ key: IntentionKey; icon: string; title: string; body: string }> = [
  { key: "find_community", icon: "⌂", title: "Find a community", body: "Discover a place and people that fit your life." },
  { key: "create_community", icon: "✦", title: "Create a community", body: "Turn an early intention into a grounded project." },
  { key: "already_creating_community", icon: "↗", title: "Already creating", body: "Bring an active group or settlement journey here." },
  { key: "represent_existing_community", icon: "◎", title: "Represent a community", body: "Share an established place and welcome people." },
  { key: "have_land", icon: "⌁", title: "Offer land", body: "Connect land with thoughtful regenerative projects." },
  { key: "teach_master", icon: "✣", title: "Teach or mentor", body: "Share practical mastery with projects and camps." },
  { key: "volunteer", icon: "♡", title: "Volunteer", body: "Contribute time, care and practical energy." },
  { key: "work", icon: "⚒", title: "Find meaningful work", body: "Join paid or collaborative opportunities." },
  { key: "support_invest", icon: "◇", title: "Support or invest", body: "Help viable projects cross important thresholds." },
  { key: "learn", icon: "◌", title: "Learn by doing", body: "Find camps, teachers and living knowledge." },
  { key: "represent_organisation", icon: "▦", title: "Represent an organisation", body: "Offer services, partnerships or resources." },
  { key: "explore", icon: "→", title: "Explore first", body: "See what is forming before choosing a path." },
];

const communityTypes = ["Intentional community", "Ecovillage", "Co-housing", "Family village", "Learning centre", "Regenerative farm"];
const lifestyleOptions = ["Natural building", "Permaculture", "Shared meals", "Family life", "Creative practice", "Local economy", "Low-impact living", "Education"];

type Props = {
  user: { id: string; email: string | null };
  destination: string;
};

export default function OnboardingForm({ user, destination }: Props) {
  const email = user.email ?? "";
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState<IntentionKey[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [headline, setHeadline] = useState("");
  const [country, setCountry] = useState("");
  const [region, setRegion] = useState("");
  const [city, setCity] = useState("");
  const [relocationReadiness, setRelocationReadiness] = useState("");
  const [preferredPlaces, setPreferredPlaces] = useState("");
  const [desiredCommunityTypes, setDesiredCommunityTypes] = useState<string[]>([]);
  const [lifestyleInterests, setLifestyleInterests] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/account", { cache: "no-store", credentials: "same-origin", signal: controller.signal });
        const payload = await readAccountResponse(response);
        const snapshot = normalizeAccountPayload(payload, user.id, email);
        setSelected(snapshot.intentions);
        setDisplayName(snapshot.profile.displayName || snapshot.account.displayName || email.split("@")[0]);
        setHeadline(snapshot.profile.headline);
        setCountry(snapshot.profile.country);
        setRegion(snapshot.profile.region);
        setCity(snapshot.profile.city);
        setRelocationReadiness(snapshot.profile.relocationReadiness);
        setPreferredPlaces([...snapshot.profile.preferredCountries, ...snapshot.profile.preferredRegions].join(", "));
        setDesiredCommunityTypes(snapshot.profile.desiredCommunityTypes);
        setLifestyleInterests(snapshot.profile.lifestyleInterests);
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(caught instanceof Error ? caught.message : "We could not load your account.");
        setDisplayName(email.split("@")[0]);
      } finally {
        setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [email, user.id]);

  function toggleIntention(key: IntentionKey) {
    setSelected((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  }

  function toggleList(value: string, setter: React.Dispatch<React.SetStateAction<string[]>>) {
    setter((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  }

  function nextStep() {
    setError(null);
    if (step === 0 && selected.length === 0) {
      setError("Choose at least one reason for joining Hearthland.");
      return;
    }
    if (step === 1 && !displayName.trim()) {
      setError("Add the name people should know you by.");
      return;
    }
    setStep((current) => Math.min(2, current + 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    setNotice(null);

    const preferredRegions = preferredPlaces.split(",").map((item) => item.trim()).filter(Boolean);
    try {
      const response = await fetch("/api/account", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "onboarding",
          intentions: selected,
          profile: {
            displayName: displayName.trim(),
            headline: headline.trim(),
            country: country.trim(),
            region: region.trim(),
            city: city.trim(),
            relocationReadiness,
            preferredRegions,
            desiredCommunityTypes,
            lifestyleInterests,
          },
        }),
      });
      await readAccountResponse(response);
      setNotice("Your Hearthland journey is ready. Taking you to your dashboard…");
      window.setTimeout(() => window.location.assign(destination), 700);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We could not save your onboarding.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AccountShell active="onboarding" email={email} name={displayName}>
      {loading ? <LoadingPanel label="Preparing your first steps…" /> : (
        <>
          <section className={styles.heroPanel}>
            <div>
              <span className={styles.eyebrow}>BEGIN YOUR JOURNEY</span>
              <h1>What brings you to Hearthland?</h1>
              <p>Your answer shapes the people, projects, camps and places we recommend. Choose every path that feels true—you can change these later.</p>
              <div className={styles.stepBar} aria-hidden="true">
                {[0, 1, 2].map((item) => <span className={item <= step ? styles.stepActive : undefined} key={item} />)}
              </div>
            </div>
            <div className={styles.heroMotif} aria-hidden="true"><strong>{step + 1}<br />of 3</strong></div>
          </section>

          <form className={`${styles.card} ${styles.onboardingCard}`} onSubmit={submit}>
            <div className={styles.onboardingBody}>
              <div className={styles.stepMeta}><span>Step {step + 1}</span><span>{step === 0 ? "Your intentions" : step === 1 ? "A little about you" : "Your ideal direction"}</span></div>

              {step === 0 && (
                <>
                  <div className={styles.onboardingTitle}>
                    <h2>Choose your paths.</h2>
                    <p>Most people arrive with more than one intention. Select as many as you need.</p>
                  </div>
                  <div className={styles.choiceGridWide}>
                    {intentions.map((intention) => (
                      <label aria-label={intention.title} className={styles.choiceCard} htmlFor={`intention-${intention.key}`} key={intention.key}>
                        <input id={`intention-${intention.key}`} type="checkbox" checked={selected.includes(intention.key)} onChange={() => toggleIntention(intention.key)} />
                        <span><b aria-hidden="true">{intention.icon}</b><strong>{intention.title}</strong><small>{intention.body}</small></span>
                      </label>
                    ))}
                  </div>
                </>
              )}

              {step === 1 && (
                <>
                  <div className={styles.onboardingTitle}>
                    <h2>Introduce yourself.</h2>
                    <p>Start simply. You can build a richer public profile after onboarding.</p>
                  </div>
                  <div className={styles.formGrid}>
                    <label className={styles.field}><span>Display name</span><input autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} required placeholder="How people will know you" /></label>
                    <label className={styles.field}><span>Headline</span><input value={headline} onChange={(event) => setHeadline(event.target.value)} placeholder="Natural builder · facilitator · future resident" /></label>
                    <label className={styles.field}><span>Country</span><input autoComplete="country-name" value={country} onChange={(event) => setCountry(event.target.value)} placeholder="Czech Republic" /></label>
                    <label className={styles.field}><span>Region</span><input autoComplete="address-level1" value={region} onChange={(event) => setRegion(event.target.value)} placeholder="South Bohemia" /></label>
                    <label className={styles.field}><span>City or nearest place</span><input autoComplete="address-level2" value={city} onChange={(event) => setCity(event.target.value)} placeholder="České Budějovice" /></label>
                    <label className={styles.field}><span>Relocation readiness</span><select value={relocationReadiness} onChange={(event) => setRelocationReadiness(event.target.value)}><option value="">Choose an answer</option><option value="not_considering">Staying where I am</option><option value="curious">Curious about relocating</option><option value="planning">Planning a move</option><option value="ready">Ready for the right place</option><option value="already_relocating">Already relocating</option></select></label>
                  </div>
                </>
              )}

              {step === 2 && (
                <>
                  <div className={styles.onboardingTitle}>
                    <h2>What kind of life are you moving toward?</h2>
                    <p>These signals make early matches more useful. Everything here remains editable.</p>
                  </div>
                  <div className={styles.formGrid}>
                    <label className={`${styles.field} ${styles.fullSpan}`}><span>Countries or regions of interest</span><input value={preferredPlaces} onChange={(event) => setPreferredPlaces(event.target.value)} placeholder="South Bohemia, Slovakia, Portugal" /><small>Separate places with commas.</small></label>
                    <fieldset className={`${styles.field} ${styles.fullSpan}`}><legend>Community types</legend><div className={styles.chipGrid}>{communityTypes.map((item) => <label className={styles.chip} key={item}><input type="checkbox" checked={desiredCommunityTypes.includes(item)} onChange={() => toggleList(item, setDesiredCommunityTypes)} /><span>{item}</span></label>)}</div></fieldset>
                    <fieldset className={`${styles.field} ${styles.fullSpan}`}><legend>Lifestyle interests</legend><div className={styles.chipGrid}>{lifestyleOptions.map((item) => <label className={styles.chip} key={item}><input type="checkbox" checked={lifestyleInterests.includes(item)} onChange={() => toggleList(item, setLifestyleInterests)} /><span>{item}</span></label>)}</div></fieldset>
                  </div>
                </>
              )}

              {error && <p className={`${styles.message} ${styles.errorMessage}`} role="alert">{error}</p>}
              {notice && <p className={`${styles.message} ${styles.successMessage}`} role="status">{notice}</p>}
            </div>

            <div className={styles.formActions}>
              <small>Your answers are private until you choose what belongs on your public profile.</small>
              <div>
                {step > 0 && <button className={styles.secondaryButton} type="button" disabled={saving} onClick={() => { setError(null); setStep((current) => current - 1); }}>Back</button>}
                {step < 2
                  ? <button className={styles.primaryButton} type="button" onClick={nextStep}>Continue <span aria-hidden="true">→</span></button>
                  : <button className={styles.primaryButton} disabled={saving} type="submit">{saving ? "Saving your journey…" : "Complete onboarding"} <span aria-hidden="true">→</span></button>}
              </div>
            </div>
          </form>
        </>
      )}
    </AccountShell>
  );
}
