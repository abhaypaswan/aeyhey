"use client";
// SPDX-License-Identifier: AGPL-3.0-only
// The work side of the public page (PRD 28.6c): headline, links, skills, interests,
// experience and projects, so the page can stand in for a CV or a LinkedIn profile.
//
// "Fill from my resume" only fills the form. Nothing is public until the person saves.

import { useState } from "react";
import { apiClient, ApiRequestError } from "../lib/client";
import { Plus, Trash2 } from "./icons";
import { Button, Card, CardTitle, Field, Input, Notice, Textarea } from "./ui";

export interface WorkLink {
  label: string;
  url: string;
}

export interface WorkJob {
  role: string;
  company: string;
  start?: string | null;
  end?: string | null;
  summary?: string | null;
}

export interface WorkProject {
  name: string;
  description?: string | null;
  url?: string | null;
  tech?: string[];
}

export interface WorkSide {
  headline: string | null;
  location: string | null;
  links: WorkLink[];
  skills: string[];
  interests: string[];
  experience: WorkJob[];
  projects: WorkProject[];
}

interface ResumeDraft {
  headline: string | null;
  skills: string[];
  experience: WorkJob[];
  projects: WorkProject[];
}

const splitList = (text: string): string[] =>
  text
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

function RowHead({ title, onRemove }: { title: string; onRemove: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm font-semibold">{title}</span>
      <Button size="sm" tone="ghost" icon={Trash2} onClick={onRemove}>
        Remove
      </Button>
    </div>
  );
}

export function PublicPageWork({ initial }: { initial: WorkSide }) {
  const [headline, setHeadline] = useState(initial.headline ?? "");
  const [location, setLocation] = useState(initial.location ?? "");
  const [links, setLinks] = useState<WorkLink[]>(initial.links);
  const [skills, setSkills] = useState(initial.skills.join(", "));
  const [interests, setInterests] = useState(initial.interests.join(", "));
  const [jobs, setJobs] = useState<WorkJob[]>(initial.experience);
  const [projects, setProjects] = useState<WorkProject[]>(initial.projects);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const editJob = (i: number, patch: Partial<WorkJob>) =>
    setJobs((all) => all.map((job, j) => (j === i ? { ...job, ...patch } : job)));
  const editProject = (i: number, patch: Partial<WorkProject>) =>
    setProjects((all) => all.map((project, j) => (j === i ? { ...project, ...patch } : project)));
  const editLink = (i: number, patch: Partial<WorkLink>) =>
    setLinks((all) => all.map((link, j) => (j === i ? { ...link, ...patch } : link)));

  async function fillFromResume(): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const draft = await apiClient.get<ResumeDraft>("/api/public-page/resume-draft");
      // Only empty parts are filled, so nothing typed by hand is lost.
      const filled: string[] = [];
      if (!headline.trim() && draft.headline) {
        setHeadline(draft.headline);
        filled.push("headline");
      }
      if (!skills.trim() && draft.skills.length > 0) {
        setSkills(draft.skills.join(", "));
        filled.push("skills");
      }
      if (jobs.length === 0 && draft.experience.length > 0) {
        setJobs(draft.experience);
        filled.push("experience");
      }
      if (projects.length === 0 && draft.projects.length > 0) {
        setProjects(draft.projects);
        filled.push("projects");
      }
      setMessage({
        ok: true,
        text:
          filled.length > 0
            ? `Filled ${filled.join(", ")} from your resume. Check it, then save.`
            : "Everything the resume has is already filled in.",
      });
    } catch (caught) {
      setMessage({
        ok: false,
        text: caught instanceof ApiRequestError ? caught.message : "That did not work.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function save(): Promise<void> {
    setBusy(true);
    setMessage(null);
    const blank = (value: string | null | undefined) =>
      value && value.trim() ? value.trim() : null;
    try {
      await apiClient.patch("/api/public-page", {
        headline: blank(headline),
        location: blank(location),
        links: links.filter((link) => link.label.trim() && link.url.trim()),
        skills: splitList(skills),
        interests: splitList(interests),
        experience: jobs
          .filter((job) => job.role.trim() && job.company.trim())
          .map((job) => ({
            role: job.role,
            company: job.company,
            start: blank(job.start),
            end: blank(job.end),
            summary: blank(job.summary),
          })),
        projects: projects
          .filter((project) => project.name.trim())
          .map((project) => ({
            name: project.name,
            description: blank(project.description),
            url: blank(project.url),
            tech: project.tech ?? [],
          })),
      });
      setMessage({ ok: true, text: "Saved. It shows on your page now." });
    } catch (caught) {
      const text =
        caught instanceof ApiRequestError
          ? caught.fields
            ? `${caught.message} ${Object.values(caught.fields).flat()[0] ?? ""}`
            : caught.message
          : "That did not work.";
      setMessage({ ok: false, text });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle>Work and interests</CardTitle>
          <p className="text-muted-foreground text-sm">
            All optional. Add your work and projects to send the page with a job application, or
            just your interests.
          </p>
        </div>
        <Button size="sm" disabled={busy} onClick={() => void fillFromResume()}>
          Fill from my resume
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Headline" hint="For example: Backend engineer at Acme">
          <Input value={headline} maxLength={120} onChange={(e) => setHeadline(e.target.value)} />
        </Field>
        <Field label="Location">
          <Input value={location} maxLength={80} onChange={(e) => setLocation(e.target.value)} />
        </Field>
      </div>

      <div className="flex flex-col gap-3">
        <span className="text-sm font-semibold">Links</span>
        {links.map((link, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <div className="w-32">
              <Input
                aria-label="Link name"
                placeholder="GitHub"
                value={link.label}
                maxLength={30}
                onChange={(e) => editLink(i, { label: e.target.value })}
              />
            </div>
            <div className="min-w-48 flex-1">
              <Input
                aria-label="Web address"
                placeholder="https://github.com/you"
                value={link.url}
                maxLength={300}
                onChange={(e) => editLink(i, { url: e.target.value })}
              />
            </div>
            <Button
              size="sm"
              tone="ghost"
              icon={Trash2}
              aria-label="Remove link"
              onClick={() => setLinks((all) => all.filter((_, j) => j !== i))}
            />
          </div>
        ))}
        {links.length < 6 ? (
          <Button
            size="sm"
            icon={Plus}
            className="self-start"
            onClick={() => setLinks((all) => [...all, { label: "", url: "https://" }])}
          >
            Add a link
          </Button>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Skills" hint="Separate with commas">
          <Input value={skills} onChange={(e) => setSkills(e.target.value)} />
        </Field>
        <Field label="Interests" hint="Separate with commas">
          <Input value={interests} onChange={(e) => setInterests(e.target.value)} />
        </Field>
      </div>

      <div className="flex flex-col gap-3">
        <span className="text-sm font-semibold">Experience</span>
        {jobs.map((job, i) => (
          <div key={i} className="border-border flex flex-col gap-3 rounded-lg border p-3">
            <RowHead
              title={job.role || "New role"}
              onRemove={() => setJobs((all) => all.filter((_, j) => j !== i))}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Role">
                <Input
                  value={job.role}
                  maxLength={80}
                  onChange={(e) => editJob(i, { role: e.target.value })}
                />
              </Field>
              <Field label="Company">
                <Input
                  value={job.company}
                  maxLength={80}
                  onChange={(e) => editJob(i, { company: e.target.value })}
                />
              </Field>
              <Field label="From" hint="For example: Mar 2023">
                <Input
                  value={job.start ?? ""}
                  maxLength={20}
                  onChange={(e) => editJob(i, { start: e.target.value })}
                />
              </Field>
              <Field label="To" hint="Leave empty for present">
                <Input
                  value={job.end ?? ""}
                  maxLength={20}
                  onChange={(e) => editJob(i, { end: e.target.value })}
                />
              </Field>
            </div>
            <Field label="What you did">
              <Textarea
                rows={2}
                maxLength={400}
                value={job.summary ?? ""}
                onChange={(e) => editJob(i, { summary: e.target.value })}
              />
            </Field>
          </div>
        ))}
        {jobs.length < 10 ? (
          <Button
            size="sm"
            icon={Plus}
            className="self-start"
            onClick={() => setJobs((all) => [...all, { role: "", company: "" }])}
          >
            Add a role
          </Button>
        ) : null}
      </div>

      <div className="flex flex-col gap-3">
        <span className="text-sm font-semibold">Projects</span>
        {projects.map((project, i) => (
          <div key={i} className="border-border flex flex-col gap-3 rounded-lg border p-3">
            <RowHead
              title={project.name || "New project"}
              onRemove={() => setProjects((all) => all.filter((_, j) => j !== i))}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name">
                <Input
                  value={project.name}
                  maxLength={80}
                  onChange={(e) => editProject(i, { name: e.target.value })}
                />
              </Field>
              <Field label="Link" hint="Optional, starting with https://">
                <Input
                  value={project.url ?? ""}
                  maxLength={300}
                  onChange={(e) => editProject(i, { url: e.target.value })}
                />
              </Field>
            </div>
            <Field label="What it is">
              <Textarea
                rows={2}
                maxLength={300}
                value={project.description ?? ""}
                onChange={(e) => editProject(i, { description: e.target.value })}
              />
            </Field>
            <Field label="Built with" hint="Separate with commas">
              <Input
                value={(project.tech ?? []).join(", ")}
                onChange={(e) => editProject(i, { tech: splitList(e.target.value).slice(0, 8) })}
              />
            </Field>
          </div>
        ))}
        {projects.length < 8 ? (
          <Button
            size="sm"
            icon={Plus}
            className="self-start"
            onClick={() => setProjects((all) => [...all, { name: "" }])}
          >
            Add a project
          </Button>
        ) : null}
      </div>

      {message ? <Notice tone={message.ok ? "success" : "error"}>{message.text}</Notice> : null}
      <Button tone="primary" disabled={busy} className="self-start" onClick={() => void save()}>
        Save work and interests
      </Button>
    </Card>
  );
}
