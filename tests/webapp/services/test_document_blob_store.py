from concurrent.futures import ThreadPoolExecutor

import pytest

from webapp.services.document_blob_store import DocumentBlobError, DocumentBlobStore


def test_publish_and_verified_read_are_content_addressed(tmp_path):
    store = DocumentBlobStore(tmp_path)
    published = store.publish(b"exact bytes")
    assert published["storage_key"].startswith("sha256/")
    assert store.read(published) == b"exact bytes"


def test_identical_publishes_converge_without_clobber(tmp_path):
    store = DocumentBlobStore(tmp_path)
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _: store.publish(b"same"), range(8)))
    assert len({item["storage_key"] for item in results}) == 1
    assert store.read(results[0]) == b"same"


def test_existing_corruption_fails_closed_and_is_not_repaired(tmp_path):
    store = DocumentBlobStore(tmp_path)
    item = store.publish(b"original")
    path = store._path(item["storage_key"])
    path.write_bytes(b"corrupt")
    with pytest.raises(DocumentBlobError):
        store.publish(b"original")
    assert path.read_bytes() == b"corrupt"
    with pytest.raises(DocumentBlobError):
        store.read(item)


@pytest.mark.parametrize("key", ["../secret", "sha256/aa/../../x.docx", "sha256/AA/" + "a" * 64 + ".docx"])
def test_storage_key_cannot_escape_or_vary_from_digest(tmp_path, key):
    with pytest.raises(DocumentBlobError):
        DocumentBlobStore(tmp_path)._path(key)
