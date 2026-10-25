#!/bin/sh
# Prints the Homebrew formula for a release.
# Usage: homebrew-formula.sh <version> <folder holding the release's .sha256 files>
set -eu

version=$1
dir=$2
url="https://github.com/julianbonomini/vago/releases/download/v$version"

# The url and sha256 lines for one release target.
asset() {
	file="vago-$1.tar.gz"
	sum=$(cut -d ' ' -f 1 "$dir/$file.sha256")
	printf '      url "%s/%s"\n      sha256 "%s"\n' "$url" "$file" "$sum"
}

cat <<FORMULA
class Vago < Formula
  desc "Build a Goal in your repo while you're away"
  homepage "https://github.com/julianbonomini/vago"
  version "$version"
  license "MIT"

  on_macos do
    on_arm do
$(asset darwin-arm64)
    end
    on_intel do
$(asset darwin-x64)
    end
  end

  on_linux do
    on_arm do
$(asset linux-arm64)
    end
    on_intel do
$(asset linux-x64)
    end
  end

  def install
    bin.install "vago"
  end

  test do
    assert_match "vago", shell_output("#{bin}/vago --help")
  end
end
FORMULA
