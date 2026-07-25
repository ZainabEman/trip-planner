"""
Development settings — extends base settings with relaxed security for local work.
"""
from .base import *  # noqa: F401,F403

# =============================================================================
# Development overrides
# =============================================================================

DEBUG = True

ALLOWED_HOSTS = ['*']

# CORS — allow all origins in development
CORS_ALLOW_ALL_ORIGINS = True
