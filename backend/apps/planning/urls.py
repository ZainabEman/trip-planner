from rest_framework.routers import SimpleRouter

from apps.planning.views import TripViewSet

router = SimpleRouter(trailing_slash=True)
router.register('trips', TripViewSet, basename='trip')

urlpatterns = router.urls
