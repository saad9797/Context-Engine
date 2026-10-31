import json
from copy import deepcopy

import pytest
from django.contrib.auth.models import User
from rest_framework.test import APIClient

from .context_packs import build_packs, imports_for, prisma_blocks, token_estimate
from .models import IngestionContext
from .models import GitHubAppInstallation, IngestionJob
from unittest.mock import patch, MagicMock
from .privacy import safe_snapshot


@pytest.fixture
def project():
    return {"codebase": {"stack": {"languages": ["TypeScript"], "orms": ["Prisma"], "package_json": {"dependencies": {"express": "^5", "@prisma/client": "^5", "zod": "^4"}, "devDependencies": {"jest": "^30"}}}, "key_files_by_role": {
        "data-model": [{"path": "prisma/schema.prisma", "content": 'model Interview {\n id Int @id\n status InterviewStatus\n applicant Applicant @relation(fields: [applicantId], references: [id])\n applicantId Int\n @@map("interviews")\n}\nmodel Applicant {\n id Int @id\n interviews Interview[]\n}\nenum InterviewStatus {\n SCHEDULED\n CANCELLED\n}'}],
        "shared-contract": [{"path": "src/utils/response.ts", "content": "export function sendSuccess(res, data) { return res.json({ data }); }"}],
        "middleware": [{"path": "src/middleware/authMiddleware.ts", "content": "export const auth = (req,res,next) => { req.user = {id: 1, role: 'recruiter'}; next(); };"}],
        "route/controller": [
            {"path": "src/controllers/interviewController.ts", "content": "import {sendSuccess} from '../utils/response';\nexport const interview = (req,res) => sendSuccess(res, {status: 'SCHEDULED'});"},
            {"path": "src/routes/interviewRoutes.ts", "content": "import {interview} from '../controllers/interviewController';\nrouter.post('/interviews', auth, interview);"},
            {"path": "src/controllers/payrollController.ts", "content": "export const payroll = 1; // [truncated — too large]"},
        ],
    }}, "database": {"tables": [{"name": "users", "sample_rows": [{"email": "real@example.org", "routing_number": "123456789"}]}], "enums": []}}


def test_exact_models_relations_maps_enums_and_contracts(project):
    output = build_packs(project, {"task": "Schedule interviews", "max_tokens": 4000})
    assert 'Make useful progress now' in output['handoff']['instruction']
    assert 'not an automatic reason to stop' in output['handoff']['instruction']
    assert 'MISSING_CONTEXT' not in output['handoff']['instruction']
    names = {block["name"] for block in output["task"]["models"]}
    assert names == {"Interview", "Applicant", "InterviewStatus"}
    assert any('@@map("interviews")' in block["content"] for block in output["task"]["models"])
    assert "CANCELLED" in json.dumps(output)
    assert {f["path"] for f in output["base"]["example"]} == {"src/controllers/interviewController.ts", "src/routes/interviewRoutes.ts"}
    assert "src/utils/response.ts" in {f["path"] for f in output["base"]["contracts"]}
    assert "real@example.org" not in json.dumps(output)
    assert "devDependencies" not in json.dumps(output)


def test_budget_omits_whole_units_not_fragments(project):
    project["codebase"]["key_files_by_role"]["service"] = [{"path": "src/services/interviewService.ts", "content": "export const x = '" + "x" * 20000 + "';"}]
    output = build_packs(project, {"task": "Schedule interviews", "max_tokens": 2000})
    assert token_estimate(output["base"]) <= 2000
    assert token_estimate(output["task"]) <= 2000
    assert all(f["path"] != "src/services/interviewService.ts" for f in output["task"]["code"])
    assert any(item["path"] == "src/services/interviewService.ts" for item in output["report"]["omitted"])


def test_unknown_task_does_not_dump_full_project(project):
    output = build_packs(project, {"task": "Implement quantum teleportation", "max_tokens": 4000})
    assert output["task"]["code"] == []
    assert output["task"]["models"] == []
    assert any("No source filenames matched" in gap for gap in output["report"]["missing"])


def test_pins_and_javascript_extension_resolution(project):
    assert imports_for("src/routes/a.ts", "import x from '../utils/response.js'", {"src/utils/response.ts"}) == {"src/utils/response.ts"}
    result = build_packs(project, {"task": "Change unrelated behavior", "include_paths": ["prisma/schema.prisma", "not-captured.ts"], "max_tokens": 4000})
    assert result["task"]["models"]
    assert any("not-captured.ts" in gap for gap in result["report"]["missing"])
    assert imports_for("app/billing/views.py", "from ..auth import permissions", {"app/auth.py", "app/billing/auth.py"}) == {"app/auth.py"}


def test_balanced_prisma_blocks_ignore_comments_and_quoted_braces():
    source = '// model Fake { }\nmodel Real {\n value String @default("}")\n /* } */\n}\nenum Mode {\n A\n B\n}'
    assert [b["name"] for b in prisma_blocks(source)] == ["Real", "Mode"]
    assert len(prisma_blocks("model Broken {\n name String")) == 0


def test_base_identity_stable_across_tasks_but_changes_with_source(project):
    one = build_packs(project, {"task": "interviews", "max_tokens": 4000})
    two = build_packs(project, {"task": "applicants", "max_tokens": 4000})
    assert one["base"] == two["base"]
    project["codebase"]["key_files_by_role"]["shared-contract"][0]["content"] += " // new contract"
    three = build_packs(project, {"task": "interviews", "max_tokens": 4000})
    assert one["base"]["base_id"] != three["base"]["base_id"]


def test_legacy_privacy_scrubs_samples_and_shape_values():
    original = {"sample_rows": [{"email": "real@example.org"}], "mongo": {"sample_documents": [{"ach": "secret-file"}], "schema_shape": {"email": "string(real@example.org)", "id": "ObjectId(012345)"}}, "source": "const password = 'real-secret';\nconst user = req.user;"}
    clean = safe_snapshot(original)
    assert "real@example.org" not in json.dumps(clean)
    assert "secret-file" not in json.dumps(clean)
    assert "real-secret" not in json.dumps(clean)
    assert clean["mongo"]["schema_shape"]["id"] == "ObjectId"
    assert "req.user" in clean["source"]


def test_sql_first_preserves_enum_names_and_values():
    raw = {"database": {"tables": [{"name": "interviews", "columns": [{"name": "status", "type": "USER-DEFINED", "udt": "InterviewStatus"}], "sample_rows": [{"status": "secret"}]}], "enums": [{"name": "InterviewStatus", "values": ["SCHEDULED", "CANCELLED"]}]}}
    result = build_packs(raw, {"task": "interviews", "max_tokens": 4000})
    assert result["task"]["enums"][0]["values"] == ["SCHEDULED", "CANCELLED"]
    assert "secret" not in json.dumps(result)


@pytest.mark.parametrize("path,source", [
    ("billing/models.py", "class Invoice(models.Model):\n    status = models.CharField(choices=Status.choices)\n    customer = models.ForeignKey(Customer, related_name='invoices', on_delete=models.CASCADE)\n"),
    ("src/models/invoice.ts", "export const Invoice = new mongoose.Schema({ status: {type:String, enum:['DRAFT','PAID']} });"),
    ("src/components/Invoice.tsx", "export function Invoice({ amount }: {amount:number}) { return <div>{amount}</div>; }"),
    ("src/models/invoice.py", "class Invoice(Base):\n    __tablename__ = 'billing'\n    status = Column(Enum('draft', 'paid'))\n"),
    ("app/Models/Invoice.php", "<?php class Invoice extends Model { protected $table = 'invoices'; }"),
])
def test_framework_neutral_complete_source_selection(path, source):
    raw = {"codebase": {"key_files_by_role": {"data-model": [{"path": path, "content": source}]}}}
    result = build_packs(raw, {"task": "Change invoice behavior", "max_tokens": 4000})
    assert any(unit["path"] == path and unit["content"] == source for unit in result["task"]["code"])


@pytest.mark.django_db
def test_pack_endpoint_is_tenant_scoped_and_validates_budget(project, settings):
    settings.CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
    owner = User.objects.create_user(username="pack-owner")
    other = User.objects.create_user(username="pack-other")
    snapshot = IngestionContext.objects.create(user=owner, data=project)
    api = APIClient()
    url = f"/api/ingestion/{snapshot.id}/context-pack/"
    assert api.post(url, {}, format="json").status_code in (401, 403)
    api.force_authenticate(other)
    assert api.post(url, {}, format="json").status_code == 404
    api.force_authenticate(owner)
    assert api.post(url, {"max_tokens": 0}, format="json").status_code == 400
    response = api.post(url, {"task": "interviews"}, format="json")
    assert response.status_code == 200
    assert response.data["base"]["base_id"] == response.data["task"]["base_id"]
    assert response.data['handoff']['kind'] == 'handoff'
    assert response['Cache-Control'] == 'no-store'


def test_unrelated_enums_never_displace_the_requested_model(project):
    schema = project["codebase"]["key_files_by_role"]["data-model"][0]
    schema["content"] += "\n" + "\n".join(f"enum Noise{i} {{\n ONE\n TWO\n}}" for i in range(60))
    result = build_packs(project, {"task": "Schedule interviews", "max_tokens": 2000})
    assert "Interview" in {b["name"] for b in result["task"]["models"]}
    assert all(not b["name"].startswith("Noise") for b in result["task"]["models"])


@pytest.mark.django_db
def test_rebuild_checks_current_access_and_enqueues_same_sources(project, settings):
    settings.CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
    owner = User.objects.create_user(username="rebuild-owner")
    other = User.objects.create_user(username="rebuild-other")
    snapshot = IngestionContext.objects.create(user=owner, data=project)
    original = IngestionJob.objects.create(user=owner, result=snapshot, status="succeeded", connection_refs={"github_installation_id": 123, "github_owner": "demo", "github_repo": "project"})
    api = APIClient()
    url = f"/api/ingestion/{snapshot.id}/rebuild/"
    api.force_authenticate(other)
    assert api.post(url, {}, format="json").status_code == 404
    api.force_authenticate(owner)
    assert api.post(url, {}, format="json").status_code == 400
    GitHubAppInstallation.objects.create(user=owner, installation_id=123, account_login="demo", account_type="User")
    with patch("ingestion.views_context_packs.django_rq.get_queue") as queue:
        queue.return_value.enqueue.return_value = MagicMock(id="retry-job")
        response = api.post(url, {}, format="json")
    assert response.status_code == 202
    rebuilt = IngestionJob.objects.get(pk=response.data["job_id"])
    assert rebuilt.user == owner
    assert rebuilt.connection_refs == original.connection_refs
    assert rebuilt.result_id is None
    queue.return_value.enqueue.assert_called_once()
    with patch("ingestion.views_context_packs.django_rq.get_queue") as queue:
        queue.return_value.enqueue.return_value = MagicMock(id="pinned-retry-job")
        pinned_response = api.post(url, {'include_paths': ['src/utils/missing.ts']}, format='json')
    assert pinned_response.status_code == 202
    pinned_job = IngestionJob.objects.get(pk=pinned_response.data['job_id'])
    assert pinned_job.connection_refs['github_include_paths'] == ['src/utils/missing.ts']
