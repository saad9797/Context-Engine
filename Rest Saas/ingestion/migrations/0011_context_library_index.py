from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("ingestion", "0010_source_vector_cache")]
    operations = [migrations.AddIndex(
        model_name="ingestioncontext",
        index=models.Index(fields=["user", "-created_at", "-id"], name="context_user_recent_idx"),
    )]
