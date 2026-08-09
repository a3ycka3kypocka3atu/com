"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { AccountShell, LoadingPanel, accountStyles as styles } from "../../_components/account/account-shell";
import {
  EMPTY_PROFILE,
  calculateProfileCompleteness,
  normalizeAccountPayload,
  profileSuggestions,
  readAccountResponse,
  type AccountSnapshot,
  type ProfileDraft,
  type SkillDraft,
} from "../../_components/account/account-types";
import { createClient } from "../../../lib/supabase/browser";

type Props = { user: { id: string; email: string | null } };

const communityTypes = ["Intentional community", "Ecovillage", "Co-housing", "Family village", "Learning centre", "Regenerative farm"];
const lifestyleOptions = ["Natural building", "Permaculture", "Shared meals", "Family life", "Creative practice", "Local economy", "Low-impact living", "Education"];
const lookingOptions = ["A community to join", "Co-founders", "Land", "Paid work", "Building Camps", "Teachers", "Investment", "Collaborators"];
const contributionOptions = ["Practical work", "Project leadership", "Teaching", "Facilitation", "Capital", "Land", "Professional services", "Community care"];
const valueOptions = ["Regeneration", "Mutual care", "Autonomy", "Shared responsibility", "Ecological stewardship", "Intergenerational life", "Learning", "Local resilience"];
const skillCategories = ["Building", "Land & ecology", "Community", "Food", "Education", "Business", "Health & care", "Creative", "Technical", "Other"];

function fallbackSnapshot(user: Props["user"]): AccountSnapshot {
  return {
    account: { id: user.id, email: user.email ?? "", displayName: "", onboardingStatus: "not_started", settings: {} },
    profile: { ...EMPTY_PROFILE, displayName: (user.email ?? "").split("@")[0] },
    intentions: [],
    skills: [],
  };
}

function initials(name: string, email: string) {
  const source = name.trim() || email.split("@")[0] || "H";
  return source.split(/[\s._-]+/).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("");
}

function toggleValue(values: string[], value: string) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function TagEditor({
  values,
  onChange,
  placeholder,
  addLabel = "Add",
  ariaLabel,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
  addLabel?: string;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState("");

  function addValue() {
    const additions = draft.split(",").map((value) => value.trim()).filter(Boolean);
    if (additions.length === 0) return;
    onChange(Array.from(new Set([...values, ...additions])));
    setDraft("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    addValue();
  }

  return (
    <div className={styles.tagEditor}>
      {values.length > 0 && <div className={styles.chipGrid}>{values.map((value) => <span className={styles.editableChip} key={value}>{value}<button type="button" aria-label={`Remove ${value}`} onClick={() => onChange(values.filter((item) => item !== value))}>×</button></span>)}</div>}
      <div className={styles.tagInputRow}><input aria-label={ariaLabel} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKeyDown} placeholder={placeholder} /><button className={styles.smallButton} type="button" onClick={addValue}>{addLabel}</button></div>
    </div>
  );
}

export default function ProfileEditor({ user }: Props) {
  const email = user.email ?? "";
  const [snapshot, setSnapshot] = useState<AccountSnapshot | null>(null);
  const [profile, setProfile] = useState<ProfileDraft>({ ...EMPTY_PROFILE });
  const [skills, setSkills] = useState<SkillDraft[]>([]);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState("");
  const avatarObjectUrl = useRef("");
  const [removeAvatarRequested, setRemoveAvatarRequested] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/account", { cache: "no-store", credentials: "same-origin", signal: controller.signal });
        const payload = await readAccountResponse(response);
        const next = normalizeAccountPayload(payload, user.id, email);
        setSnapshot(next);
        setProfile(next.profile);
        setSkills(next.skills);
        setAvatarPreview(next.profile.avatarUrl);
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        const fallback = fallbackSnapshot(user);
        setSnapshot(fallback);
        setProfile(fallback.profile);
        setError(caught instanceof Error ? caught.message : "We could not load your profile.");
      }
    }
    void load();
    return () => controller.abort();
  }, [email, user]);

  useEffect(() => {
    return () => {
      if (avatarObjectUrl.current) URL.revokeObjectURL(avatarObjectUrl.current);
    };
  }, []);

  function setField<Key extends keyof ProfileDraft>(key: Key, value: ProfileDraft[Key]) {
    setProfile((current) => ({ ...current, [key]: value }));
    setNotice(null);
  }

  function chooseAvatar(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError("Choose an image file for your profile photo.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Profile photos must be smaller than 5 MB.");
      return;
    }
    if (avatarObjectUrl.current) URL.revokeObjectURL(avatarObjectUrl.current);
    avatarObjectUrl.current = URL.createObjectURL(file);
    setAvatarFile(file);
    setAvatarPreview(avatarObjectUrl.current);
    setRemoveAvatarRequested(false);
    setNotice(null);
  }

  function addSkill() {
    setSkills((current) => [...current, { name: "", category: "Practical", experienceLevel: "curious", canTeach: false, willingToContribute: true }]);
  }

  function updateSkill(index: number, patch: Partial<SkillDraft>) {
    setSkills((current) => current.map((skill, position) => position === index ? { ...skill, ...patch } : skill));
    setNotice(null);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (!profile.displayName.trim()) {
      setError("Display name is required.");
      return;
    }
    const cleanSkills = skills.filter((skill) => skill.name.trim()).map((skill) => ({ ...skill, name: skill.name.trim(), category: skill.category.trim() || "Other" }));
    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const supabase = createClient();
      let avatarPath = profile.avatarPath;
      let avatarUrl = profile.avatarUrl;

      if (removeAvatarRequested && avatarPath) {
        const { error: removeError } = await supabase.storage.from("hearthland-avatars").remove([avatarPath]);
        if (removeError) throw removeError;
        avatarPath = "";
        avatarUrl = "";
      }

      if (avatarFile) {
        const rawExtension = avatarFile.name.split(".").pop()?.toLowerCase() || avatarFile.type.split("/")[1] || "jpg";
        const extension = rawExtension.replace(/[^a-z0-9]/g, "") || "jpg";
        const path = `users/${user.id}/profile.${extension}`;
        const avatarBucket = supabase.storage.from("hearthland-avatars");
        const { error: uploadError } = await avatarBucket.upload(path, avatarFile, {
          cacheControl: "3600",
          contentType: avatarFile.type,
          upsert: true,
        });
        if (uploadError) throw uploadError;
        avatarPath = path;
        const { data: signedAvatar, error: signedAvatarError } = await avatarBucket.createSignedUrl(path, 3600);
        if (signedAvatarError) throw signedAvatarError;
        avatarUrl = signedAvatar.signedUrl;
      }

      const completeness = calculateProfileCompleteness({ ...profile, avatarPath, avatarUrl }, cleanSkills);
      const profilePayload = {
        ...profile,
        displayName: profile.displayName.trim(),
        headline: profile.headline.trim(),
        bio: profile.bio.trim(),
        country: profile.country.trim(),
        region: profile.region.trim(),
        city: profile.city.trim(),
        contributionNote: profile.contributionNote.trim(),
        communitySizeMin: profile.communitySizeMin ? Number(profile.communitySizeMin) : null,
        communitySizeMax: profile.communitySizeMax ? Number(profile.communitySizeMax) : null,
        profileCompleteness: completeness,
        avatarPath,
        avatarUrl,
        avatarRemove: removeAvatarRequested,
        avatarMimeType: avatarFile?.type ?? "",
        avatarSizeBytes: avatarFile?.size ?? null,
        privacyPreferences: {
          profile: profile.profileVisibility,
          location: profile.locationVisibility,
          contact: profile.contactVisibility,
        },
      };

      const response = await fetch("/api/account", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "profile", profile: profilePayload, skills: cleanSkills }),
      });
      const payload = await readAccountResponse(response);
      const returned = normalizeAccountPayload(payload, user.id, email);
      const savedProfile = returned.profile.displayName ? { ...profilePayload, ...returned.profile, communitySizeMin: String(returned.profile.communitySizeMin || profile.communitySizeMin), communitySizeMax: String(returned.profile.communitySizeMax || profile.communitySizeMax) } as ProfileDraft : { ...profile, avatarPath, avatarUrl, profileCompleteness: completeness };
      const savedSkills = returned.profile.displayName ? returned.skills : cleanSkills;
      setProfile(savedProfile);
      setSkills(savedSkills);
      setSnapshot((current) => current ? { ...current, profile: savedProfile, skills: savedSkills } : current);
      setAvatarFile(null);
      if (avatarObjectUrl.current) URL.revokeObjectURL(avatarObjectUrl.current);
      avatarObjectUrl.current = "";
      setRemoveAvatarRequested(false);
      setAvatarPreview(avatarUrl);
      setNotice("Profile saved. Your matches now use these details.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We could not save your profile.");
    } finally {
      setSaving(false);
    }
  }

  const completeness = useMemo(() => calculateProfileCompleteness(profile, skills.filter((skill) => skill.name.trim())), [profile, skills]);
  const suggestions = useMemo(() => profileSuggestions(profile, skills.filter((skill) => skill.name.trim())), [profile, skills]);
  const avatarVisible = avatarPreview && !removeAvatarRequested;

  return (
    <AccountShell active="profile" email={email} name={profile.displayName} completeness={completeness}>
      {!snapshot ? <LoadingPanel label="Gathering your profile…" /> : (
        <form onSubmit={save}>
          <header className={styles.pageHeader}>
            <div><span className={styles.eyebrow}>YOUR PLACE IN THE NETWORK</span><h1>Shape your Hearthland profile.</h1><p>Share enough for people to understand your direction, contribution and boundaries. You control who sees each sensitive layer.</p></div>
            {notice && <span className={styles.saveState} role="status">Saved</span>}
          </header>

          <div className={styles.profileSummary}>
            <section className={`${styles.card} ${styles.avatarPanel}`}>
              <div className={styles.avatarPreview} style={avatarVisible ? { backgroundImage: `url(${avatarPreview})`, backgroundPosition: "center", backgroundSize: "cover" } : undefined} role={avatarVisible ? "img" : undefined} aria-label={avatarVisible ? `${profile.displayName || "Your"} profile photo` : undefined}>{!avatarVisible && initials(profile.displayName, email)}</div>
              <div className={styles.avatarCopy}>
                <h2>Your profile photo</h2>
                <p>JPG, PNG or WebP up to 5 MB. Stored in your protected avatars folder.</p>
                <div className={styles.chipGrid}>
                  <label className={styles.avatarUpload}><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => chooseAvatar(event.target.files?.[0])} /><span>{avatarVisible ? "Replace photo" : "Upload photo"}</span></label>
                  {avatarVisible && <button className={styles.smallButton} type="button" onClick={() => { setAvatarFile(null); if (avatarObjectUrl.current) URL.revokeObjectURL(avatarObjectUrl.current); avatarObjectUrl.current = ""; setAvatarPreview(""); setRemoveAvatarRequested(true); }}>Remove</button>}
                </div>
              </div>
            </section>
            <aside className={styles.suggestionCard}>
              <strong>{completeness}% complete</strong>
              {suggestions.length > 0 ? <ul>{suggestions.map((suggestion) => <li key={suggestion}>{suggestion}</li>)}</ul> : <p>Your profile has all the signals needed for meaningful matching.</p>}
              <p>Optional details never block a complete profile.</p>
            </aside>
          </div>

          <section className={styles.sectionCard}>
            <header className={styles.sectionHead}><span className={styles.sectionNumber}>01</span><div><h2>Basic profile</h2><p>The human introduction shown at the top of your person profile.</p></div></header>
            <div className={styles.sectionBody}>
              <div className={styles.formGrid}>
                <label className={styles.field}><span>Display name</span><input autoComplete="name" required value={profile.displayName} onChange={(event) => setField("displayName", event.target.value)} /></label>
                <label className={styles.field}><span>Headline</span><input value={profile.headline} onChange={(event) => setField("headline", event.target.value)} placeholder="Natural builder · community facilitator" /></label>
                <label className={`${styles.field} ${styles.fullSpan}`}><span>About you</span><textarea value={profile.bio} onChange={(event) => setField("bio", event.target.value)} placeholder="Share the experiences, questions and kind of future that brought you here…" /><small>{profile.bio.length} characters · around 100–500 works well.</small></label>
                <label className={styles.field}><span>Country</span><input autoComplete="country-name" value={profile.country} onChange={(event) => setField("country", event.target.value)} /></label>
                <label className={styles.field}><span>Region</span><input autoComplete="address-level1" value={profile.region} onChange={(event) => setField("region", event.target.value)} /></label>
                <label className={styles.field}><span>City or nearest place</span><input autoComplete="address-level2" value={profile.city} onChange={(event) => setField("city", event.target.value)} /></label>
                <div className={styles.field}><span>Languages</span><TagEditor ariaLabel="Add a language" values={profile.languages} onChange={(values) => setField("languages", values)} placeholder="English, Czech…" /></div>
                <div className={`${styles.field} ${styles.fullSpan}`}><span>Links</span><TagEditor ariaLabel="Add a website or social link" values={profile.links} onChange={(values) => setField("links", values)} placeholder="https://your-site.example" addLabel="Add link" /></div>
              </div>
            </div>
          </section>

          <section className={styles.sectionCard}>
            <header className={styles.sectionHead}><span className={styles.sectionNumber}>02</span><div><h2>Community journey</h2><p>Describe the place, scale and way of life you are moving toward.</p></div></header>
            <div className={styles.sectionBody}>
              <div className={styles.formGrid}>
                <label className={styles.field}><span>Relocation readiness</span><select value={profile.relocationReadiness} onChange={(event) => setField("relocationReadiness", event.target.value)}><option value="">Choose an answer</option><option value="not_considering">Not considering relocation</option><option value="curious">Curious</option><option value="planning">Planning</option><option value="ready">Ready for the right place</option><option value="already_relocating">Already relocating</option></select></label>
                <label className={styles.field}><span>Availability</span><select value={profile.availability} onChange={(event) => setField("availability", event.target.value)}><option value="">Choose availability</option><option value="occasionally">Occasionally</option><option value="weekends">Weekends</option><option value="part_time">Part time</option><option value="full_time">Full time</option><option value="seasonal">Seasonal</option><option value="discuss">Open to discussion</option></select></label>
                <div className={styles.field}><span>Preferred countries</span><TagEditor ariaLabel="Add a preferred country" values={profile.preferredCountries} onChange={(values) => setField("preferredCountries", values)} placeholder="Czech Republic…" /></div>
                <div className={styles.field}><span>Preferred regions</span><TagEditor ariaLabel="Add a preferred region" values={profile.preferredRegions} onChange={(values) => setField("preferredRegions", values)} placeholder="South Bohemia…" /></div>
                <div className={styles.field}><span>Smallest community</span><input type="number" min="1" inputMode="numeric" value={profile.communitySizeMin} onChange={(event) => setField("communitySizeMin", event.target.value)} placeholder="12" /></div>
                <div className={styles.field}><span>Largest community</span><input type="number" min="1" inputMode="numeric" value={profile.communitySizeMax} onChange={(event) => setField("communitySizeMax", event.target.value)} placeholder="80" /></div>
                <fieldset className={`${styles.field} ${styles.fullSpan}`}><legend>Community types</legend><div className={styles.chipGrid}>{communityTypes.map((item) => <label className={styles.chip} key={item}><input type="checkbox" checked={profile.desiredCommunityTypes.includes(item)} onChange={() => setField("desiredCommunityTypes", toggleValue(profile.desiredCommunityTypes, item))} /><span>{item}</span></label>)}</div></fieldset>
                <fieldset className={`${styles.field} ${styles.fullSpan}`}><legend>Lifestyle interests</legend><div className={styles.chipGrid}>{lifestyleOptions.map((item) => <label className={styles.chip} key={item}><input type="checkbox" checked={profile.lifestyleInterests.includes(item)} onChange={() => setField("lifestyleInterests", toggleValue(profile.lifestyleInterests, item))} /><span>{item}</span></label>)}</div></fieldset>
              </div>
            </div>
          </section>

          <section className={styles.sectionCard}>
            <header className={styles.sectionHead}><span className={styles.sectionNumber}>03</span><div><h2>Skills and teaching</h2><p>Add practical or professional skills, then say whether you can teach or contribute them.</p></div><button className={styles.smallButton} type="button" onClick={addSkill}>＋ Add skill</button></header>
            <div className={styles.sectionBody}>
              {skills.length === 0 ? <div className={styles.emptyState}><strong>No skills added yet</strong><p>Add one skill to improve project, community and camp matching.</p><button className={styles.textButton} type="button" onClick={addSkill}>Add your first skill →</button></div> : (
                <div className={styles.skillList}>
                  {skills.map((skill, index) => (
                    <div className={styles.skillRow} key={skill.id ?? `new-${index}`}>
                      <label className={styles.field}><span>Skill</span><input value={skill.name} onChange={(event) => updateSkill(index, { name: event.target.value })} placeholder="Timber framing" /></label>
                      <label className={styles.field}><span>Category</span><select value={skill.category} onChange={(event) => updateSkill(index, { category: event.target.value })}>{skillCategories.map((category) => <option key={category}>{category}</option>)}</select></label>
                      <label className={styles.field}><span>Experience</span><select value={skill.experienceLevel} onChange={(event) => updateSkill(index, { experienceLevel: event.target.value as SkillDraft["experienceLevel"] })}><option value="curious">Curious</option><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option><option value="expert">Expert</option></select></label>
                      <div className={styles.skillChecks}><label className={styles.checkLine}><input type="checkbox" checked={skill.canTeach} onChange={(event) => updateSkill(index, { canTeach: event.target.checked })} /> I can teach this</label><label className={styles.checkLine}><input type="checkbox" checked={skill.willingToContribute} onChange={(event) => updateSkill(index, { willingToContribute: event.target.checked })} /> I can contribute</label><button className={styles.textButton} type="button" onClick={() => setSkills((current) => current.filter((_, position) => position !== index))}>Remove</button></div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className={styles.sectionCard}>
            <header className={styles.sectionHead}><span className={styles.sectionNumber}>04</span><div><h2>Looking for and can contribute</h2><p>Make it easy for the right people and projects to understand the exchange you seek.</p></div></header>
            <div className={styles.sectionBody}>
              <div className={styles.formGrid}>
                <fieldset className={`${styles.field} ${styles.fullSpan}`}><legend>What are you looking for?</legend><div className={styles.chipGrid}>{lookingOptions.map((item) => <label className={styles.chip} key={item}><input type="checkbox" checked={profile.lookingFor.includes(item)} onChange={() => setField("lookingFor", toggleValue(profile.lookingFor, item))} /><span>{item}</span></label>)}</div></fieldset>
                <fieldset className={`${styles.field} ${styles.fullSpan}`}><legend>What can you contribute?</legend><div className={styles.chipGrid}>{contributionOptions.map((item) => <label className={styles.chip} key={item}><input type="checkbox" checked={profile.canContribute.includes(item)} onChange={() => setField("canContribute", toggleValue(profile.canContribute, item))} /><span>{item}</span></label>)}</div></fieldset>
                <label className={`${styles.field} ${styles.fullSpan}`}><span>Anything else people should know?</span><textarea value={profile.contributionNote} onChange={(event) => setField("contributionNote", event.target.value)} placeholder="I can join two weekends each month, bring carpentry tools and help teach beginners…" /></label>
              </div>
            </div>
          </section>

          <section className={styles.sectionCard}>
            <header className={styles.sectionHead}><span className={styles.sectionNumber}>05</span><div><h2>Values</h2><p>Shared values are useful matching signals, but never a substitute for a real conversation.</p></div></header>
            <div className={styles.sectionBody}><fieldset className={styles.field}><legend>Values that matter in community</legend><div className={styles.chipGrid}>{valueOptions.map((item) => <label className={styles.chip} key={item}><input type="checkbox" checked={profile.values.includes(item)} onChange={() => setField("values", toggleValue(profile.values, item))} /><span>{item}</span></label>)}</div></fieldset></div>
          </section>

          <section className={styles.sectionCard}>
            <header className={styles.sectionHead}><span className={styles.sectionNumber}>06</span><div><h2>Privacy</h2><p>Privacy must be enforced by the account API and database policies; these selections communicate your intended access level.</p></div></header>
            <div className={styles.sectionBody}>
              <div className={styles.privacyList}>
                <label aria-label="Profile visibility" className={styles.privacyRow} htmlFor="profile-profile-visibility"><span><strong>Profile</strong><small>Your headline, bio, interests, values and contribution.</small></span><select id="profile-profile-visibility" value={profile.profileVisibility} onChange={(event) => setField("profileVisibility", event.target.value as ProfileDraft["profileVisibility"])}><option value="public">Public</option><option value="members">Members</option><option value="connections">Connections</option><option value="private">Private</option></select></label>
                <label aria-label="Location visibility" className={styles.privacyRow} htmlFor="profile-location-visibility"><span><strong>Location</strong><small>Your country, region and city. Exact private location data is never part of this profile.</small></span><select id="profile-location-visibility" value={profile.locationVisibility} onChange={(event) => setField("locationVisibility", event.target.value as ProfileDraft["locationVisibility"])}><option value="public">Public</option><option value="members">Members</option><option value="connections">Connections</option><option value="private">Private</option></select></label>
                <label aria-label="Contact visibility" className={styles.privacyRow} htmlFor="profile-contact-visibility"><span><strong>Contact and links</strong><small>Your links and any future contact information.</small></span><select id="profile-contact-visibility" value={profile.contactVisibility} onChange={(event) => setField("contactVisibility", event.target.value as ProfileDraft["contactVisibility"])}><option value="public">Public</option><option value="members">Members</option><option value="connections">Connections</option><option value="private">Private</option></select></label>
              </div>
            </div>
          </section>

          {error && <p className={`${styles.message} ${styles.errorMessage}`} role="alert">{error}</p>}
          {notice && <p className={`${styles.message} ${styles.successMessage}`} role="status">{notice}</p>}

          <div className={styles.formActions}>
            <small>Your saved profile becomes the source for recommendations and public profile data.</small>
            <div><button className={styles.secondaryButton} type="button" onClick={() => window.location.assign("/dashboard")}>Cancel</button><button className={styles.primaryButton} disabled={saving} type="submit">{saving ? "Saving profile…" : "Save profile"} <span aria-hidden="true">→</span></button></div>
          </div>
        </form>
      )}
    </AccountShell>
  );
}
