from app.services.scoring import normalize


def test_normalize_lowercase():
    assert normalize("Apple") == normalize("apple")


def test_normalize_punctuation():
    assert normalize("apple,") == "apple"


def test_normalize_trim_spaces():
    assert normalize("  apple  ") == "apple"


def test_normalize_inner_spaces_kept():
    assert normalize("This is a test") == "this is a test"


def test_normalize_apostrophe_is_significant():
    assert normalize("don't") != normalize("dont")
    assert normalize("don't") == "don't"


def test_normalize_keeps_chinese():
    assert normalize("苹果") == "苹果"
