import sys
import unittest
from unittest import mock

from .checks_schema import check_epcis_schema


class SchemaCheckTest(unittest.TestCase):
    def test_reports_not_run_when_jsonschema_is_missing(self):
        with mock.patch.dict(sys.modules, {"jsonschema": None}):
            result = check_epcis_schema("unused.json", ".")
        self.assertFalse(result["passed"])
        self.assertTrue(result["detail"].startswith("NOT RUN"))

    def test_reports_not_run_when_the_schema_cannot_be_loaded(self):
        fake = mock.MagicMock()
        with mock.patch.dict(sys.modules, {"jsonschema": fake}):
            result = check_epcis_schema("unused.json", ".", schema_path="/nonexistent/schema.json")
        self.assertTrue(result["detail"].startswith("NOT RUN"))


if __name__ == "__main__":
    unittest.main()
